# 運用

## モデル / プロバイダを切り替える

Bot は複数の LLM プロバイダの API キーを同時に保持できる。使うプロバイダは **モデル名文字列から自動判別** されるので、モデル名を変えるだけで切り替わる:

| モデル名の prefix | プロバイダ |
|---|---|
| `gpt-*`, `chatgpt*`, `o1*`, `o3*`, `o4*` | `openai` |
| `claude-*` | `anthropic` |
| `gemini-*` | `gemini` |

判別ロジックは [`src/llm/provider.ts`](../src/llm/provider.ts) の `inferProvider()`。

### モデル切り替え例

```bash
# 事前に gemini キーを登録
pnpm bot:set-key <bot-id> gemini --remote

# モデル変更 (Claude → Gemini)
pnpm bot:edit <bot-id> --model=gemini-2.5-flash --remote
```

対応するプロバイダのキーが未登録の状態でモデル変更すると警告が出る (が処理は通る)。警告を無視するとメンションされても `no <provider> API key registered` のログだけ出て応答できない。

### 新しいモデルを試す

上の prefix に合致するモデル名であれば新規モデルもそのまま使える。例えば `gpt-5-mini` が出た時も `pnpm bot:edit <bot-id> --model=gpt-5-mini` で切り替わる。

## 上限値の調整

[`src/config.ts`](../src/config.ts):

```ts
export const LIMITS = {
  HISTORY_MESSAGES: 200,           // LLM に渡す直近履歴の最大件数
  MAX_STORED_CONTENT_CHARS: 4000,  // 1 メッセージの保存文字数上限 (超過分は切り捨て)
  MAX_HISTORY_TOTAL_CHARS: 8000,   // LLM に渡す履歴の累計文字数 (直近から加算、超える手前で打ち切り)
  RATE_LIMIT_PER_MINUTE: 5,        // 1 チャンネル 1 分あたりの応答上限
  RATE_LIMIT_PER_HOUR: 30,         // 1 チャンネル 1 時間あたりの応答上限
} as const;
```

履歴の実効的な上限は **件数 (200) と累計文字数 (8000) の先に当たる方**。件数上限 200 は D1 のクエリ `LIMIT` で効き、累計上限はアプリ側で直近から加算しながら判定する ([`src/repository/message.ts`](../src/repository/message.ts))。

変えたら `pnpm cf:deploy`。既存の Durable Object ストレージ (レートリミットカウンタ) はそのまま生きる。

## ログ観測

### Worker のライブログ

```bash
pnpm exec wrangler tail --format pretty
# または JSON で処理したい時
pnpm exec wrangler tail --format json
```

出る主なログ:
- `rate limited: bot=... channel=...` — レートリミット発動
- `no <provider> API key registered for bot ...` — モデルに対応するキー未登録
- `bot config missing for ...` — bot 削除済みなのに webhook が来た等
- プラットフォーム API / LLM API のエラー (fetch 失敗など)

### Fly リレーのログ

```bash
cd discord-relay
fly logs
```

主なログ:
- `discord-relay starting; worker=... refresh=...ms` — 起動
- `fetchBots: received N bot(s)` — bot 一覧 refresh
- `connected bot=<id> as <Name>#0000` — Gateway 接続成立
- `forward failed bot=... status=...` — Worker への転送失敗
- `uncaughtException: ...` / `unhandledRejection: ...` — 予期せぬエラー

## D1 を直接覗く

```bash
# bot 一覧
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "SELECT id, name, model FROM bots"

# あるチャンネルの直近メッセージ
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "SELECT role, substr(content, 1, 80), datetime(created_at/1000, 'unixepoch') AS at
   FROM messages
   WHERE bot_id='<bot-id>' AND channel_id='<channel-id>'
   ORDER BY created_at DESC LIMIT 20"

# チャンネル単位の clear 履歴
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "SELECT * FROM channel_state"

# プラットフォーム登録状況 (credentials は暗号化されているので中身は見えない)
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "SELECT bot_id, platform, bot_user_id FROM bot_platforms"
```

ローカル D1 にアクセスする場合は `--remote` を `--local` に置換。

## 履歴のリセット (運用側から)

ユーザーは `clear` コマンドでリセットできるが、運用側から強制的にリセットする場合:

```bash
# 特定のチャンネルだけ
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "INSERT INTO channel_state (bot_id, platform, channel_id, cleared_at)
   VALUES ('<bot-id>', '<platform>', '<channel-id>', $(date +%s)000)
   ON CONFLICT (bot_id, platform, channel_id)
   DO UPDATE SET cleared_at = excluded.cleared_at"

# 特定 bot の全履歴 (= 全チャンネル) をリセットしたい時
pnpm exec wrangler d1 execute my-chat-bot --remote --command \
  "UPDATE channel_state SET cleared_at = $(date +%s)000 WHERE bot_id = '<bot-id>'"
```

`messages` は削除されない (監査・復旧用)。物理的に古いメッセージを削除したい場合は手動 DELETE。

## KV キャッシュの手動クリア

LINE のメンバー変更やプロフィール変更を即時反映したい時:

```bash
# 全 KV キーを確認
pnpm exec wrangler kv key list --namespace-id=<PROFILE_CACHE_ID>

# 特定キーを削除
pnpm exec wrangler kv key delete "bot:<bot-id>:group:<group-id>:members" \
  --namespace-id=<PROFILE_CACHE_ID>
```

24h TTL で自然に消えるので緊急でなければ放っておいて良い。

## Secret のローテーション

### `ENCRYPTION_KEY`

**ローテーション不可**。これで暗号化された `bot_api_keys.ciphertext` と `bot_platforms.credentials_ciphertext` が全部復号不能になる。やるなら:

1. `.env` の旧鍵で復号 → 新鍵で再暗号化するマイグレーションスクリプトを書く
2. D1 をバックアップ
3. 鍵を差し替えて DB を書き換え
4. `wrangler secret put ENCRYPTION_KEY` で新鍵に更新

現状そのスクリプトは無いので、原則この鍵は永続。

### `DISCORD_RELAY_SECRET`

Worker と Fly の両方で更新する:

```bash
# 新しい値を生成
SECRET=$(openssl rand -base64 32)

# Worker 側
echo "$SECRET" | pnpm exec wrangler secret put DISCORD_RELAY_SECRET

# Fly 側 (discord-relay ディレクトリから)
fly secrets set DISCORD_RELAY_SECRET="$SECRET"
```

両方同時に更新 (Worker 先) する間、`/internal/discord/bots` への fetch / event 転送が一時的に 401 になる。数秒〜数十秒のダウンタイム。致命的な場合は順序を工夫する。

## スキーマ変更

`migrations/` 下に新しい SQL ファイルを追加して適用:

```bash
# 例: messages に column 追加
cat > migrations/0005_add_something.sql <<'SQL'
ALTER TABLE messages ADD COLUMN something TEXT;
SQL

pnpm db:migrate:local       # ローカル検証
pnpm db:migrate:remote      # 本番
```

SQLite の制約で `ALTER TABLE ... ALTER CONSTRAINT` はできないので、CHECK 制約を変えたい時は `CREATE TABLE new → INSERT ... SELECT → DROP TABLE old → RENAME` のパターンを取る ([`migrations/0004_platform_discord.sql`](../migrations/0004_platform_discord.sql) が例)。

## 容量の確認

D1 は 1 DB あたり最大 10GB (Cloudflare の current limit、2026 年 4 月時点)。

```bash
pnpm exec wrangler d1 info my-chat-bot --remote
```

`messages` テーブルが主に伸びるので、長期運用なら古い行の削除ポリシーを検討する (現状は無期限保存)。

## プラットフォーム拡張

### 新しい LLM プロバイダを足す

1. `src/llm/<provider>.ts` で `<provider>Complete(args)` を実装
2. `src/types.ts` の `Provider` ユニオンに追加
3. `src/llm/index.ts` の `complete()` の switch に足す
4. `src/llm/provider.ts` の `inferProvider` にモデル名の prefix を足す
5. `migrations/` に `bot_api_keys.provider` の CHECK を拡張する新マイグレーションを追加

### 新しいプラットフォーム (Slack 等) を足す

1. `migrations/` で `bot_platforms.platform` の CHECK を拡張
2. `src/types.ts` の `Platform` に追加 / `<X>PlatformCredentials` 型を足す
3. `src/repository/bot.ts` に `get<X>BotPlatform` を足す
4. `src/platforms/<x>/` に webhook / verify / client / types を作る
5. `src/index.ts` にルート追加
6. `scripts/shared.ts` の `PLATFORMS` と `promptPlatformCredentials` を更新
7. 長時間接続が必要なプラットフォームなら `discord-relay/` 相当のリレーを別途用意
