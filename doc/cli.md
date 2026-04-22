# CLI リファレンス

全ての `pnpm bot:*` / `pnpm db:*` コマンドは [`scripts/`](../scripts/) 配下の TypeScript で、`tsx` で直接実行される。

## 共通フラグ

- `--remote` — 本番 D1 (Cloudflare 上) を対象にする
- `--local` — ローカル開発用 D1 (`wrangler dev` 用の sqlite バックエンド) を対象にする
- フラグを指定しないと `--local` がデフォルト

全ての bot 系コマンドは `.env` の `ENCRYPTION_KEY` / `PROJECT_NAME` が揃っている前提。

---

## `pnpm bot:create [--remote]`

新規 bot を D1 に登録する。

対話的プロンプト:

1. **Bot name** — 自由
2. **Default model** — 例: `gpt-4o-mini` / `claude-sonnet-4-6` / `gemini-2.5-flash`。プロバイダはこの文字列の prefix から自動判別される ([operations.md](operations.md))
3. **System prompt** — LLM に渡すシステムプロンプト本文
4. **API keys** — `openai` / `anthropic` / `gemini` それぞれ。空欄で skip 可。ただし **Default model に対応するプロバイダのキーは必須**
5. **Platforms** — `line` / `discord` / `line,discord` など、カンマ区切り
6. **platform 認証情報** — 選んだ platform に応じて LINE Channel secret + access token / Discord bot token を入力

完了時に bot の UUID と次に使う URL が表示される。

---

## `pnpm bot:list [--remote]`

全 bot を一覧表示。各行:

```
<bot-id>  <name>  model=<model>  keys=[provider1,provider2,...]  platforms=[line,discord]  <created ISO-8601>
```

`keys` は登録済みの LLM プロバイダ、`platforms` は登録済みの送受信プラットフォーム。

---

## `pnpm bot:edit <bot-id> [--model=X] [--system-prompt=X] [--name=X] [--remote]`

bot の属性 (model / system prompt / name) を部分更新。最低 1 つのフィールド指定が必須。

```bash
pnpm bot:edit <bot-id> --model=gemini-2.5-flash --remote
pnpm bot:edit <bot-id> --system-prompt="あなたは優しい..." --remote
pnpm bot:edit <bot-id> --name="新しい名前" --remote
```

**model 変更時**、新しいモデルに対応するプロバイダの API キーが未登録の場合に警告が出る。警告を見落として実行しても DB 更新は通るので、bot はメンションされても応答できない状態になり得る。

---

## `pnpm bot:set-key <bot-id> <provider> [--remote]`

指定 bot に LLM プロバイダ API キーを追加 or 更新 (upsert)。

```bash
pnpm bot:set-key <bot-id> gemini --remote
# → "gemini API key for bot <bot-id>:" プロンプトに貼る
```

`provider` は `openai` / `anthropic` / `gemini` のいずれか。

---

## `pnpm bot:add-platform <bot-id> <line|discord> [--remote]`

既存 bot に新しいプラットフォームを追加 or 認証情報を差し替える (upsert)。

```bash
# LINE-only bot に Discord を追加
pnpm bot:add-platform <bot-id> discord --remote

# Discord bot token のローテーション
pnpm bot:add-platform <bot-id> discord --remote
```

platform に応じて LINE Channel secret + access token / Discord bot token を対話的に入力。**認証情報更新時は `bot_user_id` が NULL にリセット** される (別 bot に切り替わった可能性があるので、次回受信時に再取得させる)。

---

## `pnpm bot:delete [--remote]`

bot を削除。`messages` / `bot_platforms` / `bot_api_keys` / `bots` 全部 CASCADE 削除。

```bash
pnpm bot:delete --remote
# → "Bot id to delete:" と "Delete ... ? (yes/no):" の 2 段プロンプト
```

復旧不能。実行前に `pnpm bot:list` で ID を再確認すること。

---

## `pnpm d1:create`

`PROJECT_NAME` と同じ名前の D1 データベースを Cloudflare 上に作成。初回セットアップ時だけ使う。出力される `database_id` は `.env` の `CF_D1_DATABASE_ID` に貼る。

---

## `pnpm db:migrate:local` / `pnpm db:migrate:remote`

[`migrations/`](../migrations/) 配下の未適用 SQL ファイルを順に実行。Wrangler 内部で適用履歴を管理するので、何度実行しても同じマイグレーションは二重適用されない。

スキーマ変更:
1. `migrations/` に `NNNN_xxx.sql` を追加
2. `pnpm db:migrate:local` でローカル検証
3. `pnpm db:migrate:remote` で本番に適用

---

## `pnpm keygen`

32 バイトのランダム値を base64 で出力。`ENCRYPTION_KEY` Worker Secret と `.env` 用。**初回セットアップでしか使わない** (鍵を再生成すると既存の暗号化データが全部復号不能になる)。

---

## `pnpm dev`

`wrangler dev` 相当 (内部的に `pnpm gen:config && wrangler dev`)。ローカルで Worker を起動、`http://localhost:8787` でアクセス可能。ローカル D1 バックエンドを使うので `pnpm db:migrate:local` 適用済みであること。

---

## `pnpm cf:deploy`

`wrangler deploy` で Cloudflare に本番デプロイ。`pnpm gen:config` を内部で必ず呼ぶので `.env` の環境変数が反映された `wrangler.toml` が生成される。

---

## `pnpm typecheck`

`tsc --noEmit`。テストランナーは未導入なので、型検査と本番動作ログだけが現状のフィードバック。

---

## Discord リレー側 (Fly.io)

`discord-relay/` に入ってから:

```bash
# 依存
pnpm install

# デプロイ
fly deploy

# 起動
fly scale count 1 --region nrt

# 手動再起動 (bot 追加後すぐ反映したい時)
fly apps restart <fly-app-name>

# ログ
fly logs

# Secret 確認
fly secrets list

# Secret 変更
fly secrets set WORKER_URL=... DISCORD_RELAY_SECRET=...
```
