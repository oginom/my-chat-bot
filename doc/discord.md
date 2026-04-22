# Discord bot

Discord は Gateway (WebSocket) 常時接続が必須なので、Cloudflare Worker 単体では完結しない。**Fly.io に常駐する軽量リレー** ([`discord-relay/`](../discord-relay/)) を経由して Worker とつなぐ。

```
Discord Gateway ──WS──▶ discord-relay (Fly.io) ──HTTPS POST──▶ Worker
                                                                   │
                               ◀────── GET /internal/discord/bots ─┘
                                       (10 分ごとに bot 一覧 refresh)
```

[setup.md](setup.md) で Worker 側の基盤と `DISCORD_RELAY_SECRET` Secret の投入まで終わっている前提。

## 1. 初回のみ: Fly リレーをデプロイ

Discord を使う最初の 1 回だけ。以降、bot の追加に Fly 側の作業は不要。

### 1-a. Fly アカウントの準備

- <https://fly.io/> でアカウント作成
- `brew install flyctl` などで CLI インストール
- `fly auth login`

> ⚠️ **Fly trial だと machine が 5 分で自動停止** します。常駐させるにはクレカ登録が必要 (<https://fly.io/trial>)。最小構成 (shared-cpu-1x / 256MB) で月 $2-3 程度。

### 1-b. リレーをデプロイ

```bash
cd discord-relay

# 依存インストール (lockfile は commit 済み)
pnpm install

# fly.toml の app 名を自分のアカウント内でユニークな名前に編集
$EDITOR fly.toml

# Fly アプリを作成 (既存の fly.toml を使う、デプロイはまだしない)
fly launch --copy-config --no-deploy

# Secrets を投入
fly secrets set \
  WORKER_URL="https://<your-worker>.<subdomain>.workers.dev" \
  DISCORD_RELAY_SECRET="<Worker Secret と同じ値>"

# デプロイ
fly deploy

# 1 台だけ常駐させる
fly scale count 1 --region nrt

# 動いているか確認
fly logs
```

期待される起動ログ:

```
discord-relay starting; worker=https://... refresh=600000ms
fetchBots: GET .../internal/discord/bots
fetchBots: response 200
fetchBots: received 0 bot(s)
```

bot が 0 件でも idle で正常。

### Fly secrets の運用方針

リレーが持つのは `WORKER_URL` と `DISCORD_RELAY_SECRET` の 2 つだけ。**Discord bot token は持たない** (都度 Worker 経由で D1 から取得) ので、bot の追加・削除で Fly 側を触る必要がない。

## 2. Discord Developer Portal で bot を用意

bot ごとに繰り返す作業。

1. <https://discord.com/developers/applications> → **New Application**
2. **Bot** タブ:
   - **Reset Token** でトークンを発行 (1 回しか表示されないのでメモ)
   - **Privileged Gateway Intents** で **MESSAGE CONTENT INTENT** を ON (必須、これが無いとメッセージ内容が空で届く)
3. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `View Channels`, `Send Messages`, `Read Message History` (最低限)
   - 生成された URL をブラウザで開いて対象サーバーに招待

### 招待後の権限モデル

Discord ではサーバーに招待した bot はデフォルトで **全ての公開チャンネル** で発言を受信できる (View Channel 権限があれば)。LINE のように「グループごとに招待」は不要。

ただし:

- **プライベートチャンネル** (鍵マーク付き): bot または bot のロールを明示的に権限オーバーライドに追加する必要あり
- **private thread**: thread の members に bot を追加する必要あり

## 3. D1 に bot を登録

### 新規 bot

```bash
pnpm bot:create --remote
```

platforms 選択で `discord` (LINE と両方なら `line,discord`)、bot token を入力。

### 既存 bot に Discord を追加

```bash
pnpm bot:list --remote          # bot-id を確認
pnpm bot:add-platform <bot-id> discord --remote
```

bot token を入力。これで `bot_platforms` に Discord 行が追加され、既存の LINE 側は影響を受けない (platform ごとに別レコード)。

## 4. リレーに反映

```bash
# 自動で 10 分以内に拾う。すぐ反映したければ:
fly apps restart <fly-app-name>
fly logs
```

期待される追加ログ:

```
fetchBots: received 1 bot(s)
connected bot=<bot-id> as <DisplayName>#0000
```

## 5. 動作確認

- **DM**: bot との DM で何か送る → 返事が返る
- **サーバーチャンネル**: bot をメンションして送信 → 返事が返る
- **`clear`**: `@bot clear` → 「会話履歴をリセットしました。」

---

## Discord 固有の振る舞い

### 応答条件

- **DM**: 常に応答
- **サーバー内チャンネル**: **bot へのメンション**がある場合のみ応答
  - ユーザーメンション (`<@USER_ID>`) が `message.mentions` に自分の userId で含まれている
  - **または** ロールメンション (`<@&ROLE_ID>`) が `message.mention_roles` に入っていて、かつそのロールが bot 自身に付与されている

### ロールメンションの扱い (注意)

Discord で bot を招待すると **bot と同名の統合ロール** が自動作成されることが多く、`@` でオートコンプリートすると **ロールの方が選択される** ケースが頻発する。そのままだと `message.mentions` が空で「メンションされていない」扱いになってしまうので、実装では:

1. `GET /guilds/{guild_id}/members/{bot_user_id}` で bot 自身のロール ID 一覧を取得
2. KV に 24h キャッシュ (`bot:<botId>:guild:<guildId>:botRoles`)
3. `message.mention_roles` と重なりがあれば「メンションされた」と判定

このおかげでユーザーメンション / ロールメンションどちらでも反応する。`clear` コマンドの前処理 (`stripAllMentions`) も両方のトークンを削除する。

### メッセージ保存

- 全発言を保存 (メンション有無に関わらず) — ただし次は除外:
  - bot 自身の発言 (`author.id === bot_user_id`): 応答の echo back 防止
  - 他 bot / webhook の発言 (`author.bot === true`)
- サーバー内では `"<表示名>: <本文>"` の形で prefix
  - 表示名は `member.nick ?? author.global_name ?? author.username` の順
- DM は prefix なし

### コンテキスト注入

Discord 側は LINE ほど情報取得しない。システムプロンプトに付けるのは:

- Bot 自身の表示名 (起動時に取得してキャッシュ)
- 会話形態 (DM / サーバー内)
- 発話者の表示名

サーバー名・メンバー一覧は現状取得していない (必要なら [`src/platforms/discord/webhook.ts`](../src/platforms/discord/webhook.ts) の `buildContextBlock` を拡張)。

### プラットフォームディレクティブ

LLM には「必要が無ければユーザー名 / サーバー名を返事に入れない」のみ指示。Discord は Markdown をレンダリングするので Markdown 禁止は入れていない ([`src/platforms/discord/webhook.ts`](../src/platforms/discord/webhook.ts) の `PLATFORM_DIRECTIVES`)。

### MESSAGE_CONTENT intent

Discord の **Privileged Intent**。ON でないと guild 内のメッセージ本文が空で届き、どの bot でも実質的に動かない。Developer Portal の Bot 設定で必ず ON にする。

Discord は 100 サーバーを超えたアプリに対して intent の verification を要求するが、小規模なうちは気にしなくて良い。

### ループ対策

LINE と同じ層 + Discord 固有:

- 自分の発話 skip (Gateway は自分の発言も流してくるため必須)
- 他 bot の発話 skip
- `checkRateLimit` で `${platform}:${botId}:${channelId}` ベースの DO カウント

## トラブルシューティング

| 症状 | 確認 |
|---|---|
| リレーが無応答 | `fly logs` で `fetchBots: response 200` が出ているか |
| `worker /internal/discord/bots failed 401` | Worker と Fly 両方の `DISCORD_RELAY_SECRET` が一致しているか |
| `fetchBots: response 404` | `WORKER_URL` のドメインが正しいか |
| リレー無限再起動 | `fly secrets list` で `WORKER_URL` / `DISCORD_RELAY_SECRET` の有無 |
| `connected` は出るが DM の返事なし | `pnpm exec wrangler tail` で Worker のエラーを確認 |
| **guild のメンションだけ無反応** | ロールメンションの可能性。この実装では両対応しているが、bot がまだ guild member として権限を持てていないと role 取得失敗する。 `fly logs` / `wrangler tail` 両方を見る |
| プライベートチャンネルで見えない | そのチャンネルの権限設定で bot / bot のロールに View Channel が無い |
| Fly machine が 5 分で stopped | trial 制限。クレカ登録が必要 |

### 役に立つコマンド

```bash
# Worker のライブログ
pnpm exec wrangler tail

# Fly リレーのログ
cd discord-relay && fly logs

# Fly リレーの再起動 (bot 追加後すぐ反映したい時)
fly apps restart <fly-app-name>

# 本番 D1 で messages を覗く
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "SELECT channel_id, role, substr(content, 1, 50) FROM messages WHERE platform='discord' ORDER BY created_at DESC LIMIT 10"
```

## token ローテーション

Discord bot token が漏洩した / 更新したい時:

1. Developer Portal でトークンを **Reset**
2. `pnpm bot:add-platform <bot-id> discord --remote` で新しい token を投入 (upsert される)
3. リレーは次の refresh (10 分以内) で新しい token を拾って再接続。すぐ反映したければ `fly apps restart`

`bot_user_id` は credential 変更時に NULL にリセットされるので、Worker が初回受信時に `/users/@me` で再取得する。
