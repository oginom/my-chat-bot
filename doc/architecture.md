# アーキテクチャ

## 構成要素

| コンポーネント | 役割 |
|---|---|
| **Cloudflare Worker (Hono)** | 全 bot の HTTP エントリ。LINE Webhook / Discord リレーからのイベント / 内部エンドポイントを捌く。LLM 呼び出しとプラットフォーム API への返信もここから |
| **D1** | bot 設定 (名前・モデル・システムプロンプト)・暗号化された API キー・プラットフォーム認証情報・会話履歴・チャンネル単位の状態を保存 |
| **Durable Object (`RateLimiter`)** | `(platform, botId, channelId)` ごとにレートリミットをカウント。1 チャンネル 1 分 5 件 / 1 時間 30 件 |
| **KV (`PROFILE_CACHE`)** | LINE のプロフィール・グループ情報、Discord のボットロール情報をキャッシュ (24h TTL)。`bot:<botId>:...` でキー名前空間を分ける |
| **Worker Secret** | `ENCRYPTION_KEY` (API キー等の AES-GCM マスター鍵) と `DISCORD_RELAY_SECRET` (Fly リレーとの HMAC / bearer) |
| **LLM プロバイダ** | OpenAI / Anthropic / Gemini。bot ごとのモデル名から自動判別 |
| **`discord-relay/` (Fly.io)** | Discord Gateway WebSocket を張る常駐プロセス。Worker にはイベントを HTTPS POST で中継。詳細は [`discord-relay/README.md`](../discord-relay/README.md) |

## リクエストの流れ

### LINE (DM / グループ / ルーム)

```
LINE Platform ──POST /webhook/line/:botId──▶ Worker
                                               │
          1. x-line-signature 検証              │
          2. 200 OK 即返し                     │
          3. waitUntil で後続                   │
                                               ▼
                              DB にメッセージを保存 (全発言)
                              メンション/DM なら:
                              └── DO でレート判定
                                  ├── clear なら channel_state 更新 → 返信
                                  └── それ以外: 履歴 + 文脈 → LLM → 返信
                                                                     │
                                                         POST /message/reply (LINE API)
```

### Discord (サーバー / DM)

```
Discord Gateway
       │ WebSocket
       ▼
discord-relay (Fly.io)
       │ MESSAGE_CREATE を転送
       │ HMAC(body) = X-Relay-Signature
       ▼
Worker ──POST /webhook/discord/:botId──▶
   1. HMAC 検証
   2. 200 OK 即返し
   3. waitUntil:
      ・DB 保存
      ・メンション/DM なら LLM 呼び出し
      ・返信は POST /channels/{id}/messages (Discord REST)
```

別途、**起動時と 10 分ごと** に relay が `GET /internal/discord/bots` を Worker に問い合わせて bot の一覧 (bot_id + 復号済み token) を取得し、必要な Gateway 接続を open / close / ローテートする。認証は `DISCORD_RELAY_SECRET` の Bearer トークン。

## D1 スキーマ

[`migrations/`](../migrations/) を順に適用した結果:

```
bots                    bot 設定 (name / model / system_prompt)
  id (UUID) PK
  name, model, system_prompt, created_at, updated_at

bot_api_keys            LLM プロバイダごとの暗号化 API キー
  PK (bot_id, provider ∈ openai|anthropic|gemini)
  ciphertext, iv (AES-GCM)

bot_platforms           プラットフォーム認証情報
  PK (bot_id, platform ∈ line|discord)
  credentials_ciphertext, credentials_iv (AES-GCM)
  bot_user_id            初回受信時に取得してキャッシュ

messages                全メッセージ (user / assistant) 無期限保存
  id AUTOINCREMENT
  bot_id, platform, channel_id, role, user_id, content, created_at
  INDEX (bot_id, platform, channel_id, created_at DESC)

channel_state           チャンネル単位のメタ状態 (現在は cleared_at のみ)
  PK (bot_id, platform, channel_id)
  cleared_at             clear コマンドが最後に実行された時刻
```

暗号化は `src/crypto.ts` の AES-GCM (IV 12 バイト、マスター鍵は 32 バイト base64)。マスター鍵 `ENCRYPTION_KEY` は CLI スクリプトには `.env` から、Worker には Cloudflare Secret から同じ値を渡す。

## 主要な振る舞い

### 応答条件

- **DM**: 常に応答
- **グループ / サーバー内チャンネル**: **自分へのメンションだけ**応答
- Discord のロールメンションは bot の統合ロールと一致すれば応答扱い (詳細は [discord.md](discord.md))

### 履歴

- **チャンネル単位で無期限保存**。TRUNCATE なし
- LINE グループ / Discord サーバーでは **メンション無しの発言も保存**。次にメンションされた時に LLM の文脈として見える
- 保存時、グループ / サーバーでは `"<発話者表示名>: <本文>"` の prefix を付ける (DM は prefix なし)
- LLM に渡すのは直近 **20 件** のみ (`LIMITS.HISTORY_MESSAGES`)

### コンテキスト注入

LLM 呼び出し時、システムプロンプトの末尾に以下を自動付与:

1. プラットフォームディレクティブ (LINE は Markdown 禁止 / Discord は Markdown OK)
2. 会話コンテキストブロック:
   - Bot 自身の表示名
   - 会話形態 (DM / グループ / ルーム / サーバー内)
   - (LINE のみ) グループ名 / 参加メンバー名リスト (KV キャッシュ)
   - (Discord) 発話者の表示名

### `clear` コマンド

- ユーザー発言が `clear` (trim + case insensitive) と完全一致で発動
- グループ / サーバーでは **メンション + `clear`** で発動 (メンション記号は自動で除去してから比較)
- `channel_state.cleared_at = now` を upsert。`messages` は削除しない
- 以降 `getRecentMessages` は `created_at > cleared_at` の行だけ返す
- 確認メッセージを投稿して完了

### レートリミット

- `RateLimiter` Durable Object、キー `${platform}:${botId}:${channelId}`
- 1 分 5 件 / 1 時間 30 件 (`src/config.ts`)
- 超えたら **silent drop** (ユーザーに通知しない)
- 無限ループ防止と lucky attacker 対策を兼ねる

### 無限ループ対策

- 自分へのメンションのみ応答
- 自分の発話 (`author.id === bot_user_id`) は保存もスキップ
- 他 bot の発話 (`author.bot === true`) は保存もスキップ (Discord 側)
- レートリミットが二重の防壁
