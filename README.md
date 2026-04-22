# my-chat-bot

Cloudflare Workers で動く LLM チャット bot。1 つの Worker で複数 bot をホストし、LINE / Discord に招待して使う。

## アーキテクチャ (要約)

- **Cloudflare Worker (Hono)** — 全 bot の HTTP エントリ。LLM 呼び出しと返信送信もここから
- **D1** — bot 設定 / 暗号化済み API キー & プラットフォーム認証情報 / 会話履歴
- **Durable Object** — `(platform, botId, channelId)` 単位のレートリミット
- **KV** — プロフィール・ロール情報の 24h キャッシュ
- **Fly.io (`discord-relay/`)** — Discord Gateway (WebSocket) を常駐で受けて Worker にリレー (Discord を使う時だけ必要)
- **LLM** — OpenAI / Anthropic / Gemini。bot ごとのモデル名から自動判別

詳細は [`doc/architecture.md`](doc/architecture.md)。

## クイックスタート

```bash
# ツール
mise trust && mise install && pnpm install

# .env を作って PROJECT_NAME などを埋める
cp .env.example .env
$EDITOR .env

# Cloudflare 認証 + D1 / KV / 鍵生成 / 初回デプロイ / Secret
# (詳細は doc/setup.md)
pnpm exec wrangler login
pnpm d1:create                      # database_id を .env に貼る
pnpm exec wrangler kv namespace create PROFILE_CACHE  # id を .env に貼る
pnpm keygen                         # 出力を .env の ENCRYPTION_KEY に貼る
pnpm db:migrate:remote
pnpm cf:deploy
pnpm exec wrangler secret put ENCRYPTION_KEY

# bot を追加 (LINE / Discord / 両方)
pnpm bot:create --remote
```

ドキュメント:

| ファイル | 内容 |
|---|---|
| [`doc/architecture.md`](doc/architecture.md) | 構成要素、リクエストフロー、D1 スキーマ、主要な振る舞い |
| [`doc/setup.md`](doc/setup.md) | Cloudflare 側の初期セットアップ、自動デプロイ設定 |
| [`doc/line.md`](doc/line.md) | LINE bot の登録と LINE 固有の振る舞い |
| [`doc/discord.md`](doc/discord.md) | Discord bot の登録、Fly.io リレーのデプロイ、Discord 固有の注意点 (ロールメンション / intent / trial) |
| [`doc/cli.md`](doc/cli.md) | `pnpm bot:*` / `pnpm db:*` 全コマンドのリファレンス |
| [`doc/operations.md`](doc/operations.md) | 運用、モデル切り替え、ログ、D1 直接クエリ、Secret ローテーション、拡張方法 |
| [`discord-relay/README.md`](discord-relay/README.md) | Fly.io リレー本体の詳細 |

## 上限値 (`src/config.ts` で変更可)

| 項目 | 値 |
|---|---|
| LLM に渡す履歴 | 直近 20 件 |
| 保存時の 1 メッセージ文字数 | 4000 で切り捨て |
| ユーザー入力上限 | 2000 文字 (超えたら無視) |
| レートリミット | 1 チャンネル 1 分 5 件 / 1 時間 30 件 |

## ディレクトリ構成

```
src/
  index.ts              Hono エントリ (ルーティング)
  config.ts             上限値定数
  env.ts                Worker bindings の型
  crypto.ts             AES-GCM 暗号化
  rate-limit.ts         Durable Object (RateLimiter)
  types.ts              共通型
  llm/                  OpenAI / Anthropic / Gemini (プロバイダ自動判別)
  platforms/line/       LINE の webhook/verify/client/profile (KV キャッシュ)
  platforms/discord/    Discord: リレーからの MESSAGE_CREATE を受けて LLM へ
  repository/           D1 アクセス
migrations/             D1 スキーマ
scripts/                bot 登録/一覧/削除 CLI
discord-relay/          Fly.io に常駐する Discord Gateway リレー (サブプロジェクト)
doc/                    このドキュメント群
```

## 既知の制約

- LLM プロバイダは OpenAI / Anthropic / Gemini のみ
- プラットフォームは LINE / Discord のみ (Slack は未対応)
- 画像・スタンプ・その他非テキストは保存も応答もしない
- `messages` は無期限保存 (容量が気になり始めたら自分で削る必要あり)

## ライセンス

(未設定)
