# 初期セットアップ

Cloudflare Worker + D1 + KV + Worker Secret を用意するところまで。プラットフォーム (LINE / Discord) の bot 追加は [line.md](line.md) / [discord.md](discord.md) 参照。

## 前提

- Cloudflare アカウント (無料プランで可)
- `mise` (ローカルツール管理) インストール済み — <https://mise.jdx.dev/>
- `flyctl` は Discord を使う場合のみ必要

## 設定ファイルの方針

`wrangler.toml` は **gitignore 済み**。リポジトリに入っているのは [`wrangler.toml.template`](../wrangler.toml.template) だけで、`PROJECT_NAME` / `CF_D1_DATABASE_ID` / `CF_KV_PROFILE_CACHE_ID` は `.env` から環境変数経由で埋め込む。

- `pnpm` スクリプト経由で wrangler を呼ぶと自動で `wrangler.toml` を生成 (`pnpm gen:config`、内部的に [`scripts/gen-wrangler-config.ts`](../scripts/gen-wrangler-config.ts))
- これにより clone した人はそれぞれの `.env` だけ書けば自分の Cloudflare アカウント / D1 / Worker 名で動かせる

**注意**: `wrangler.toml` を手で編集しても次の `pnpm gen:config` で上書きされる。恒久変更は `wrangler.toml.template` を直せ。

## 1. ツールと依存を入れる

```bash
mise trust                   # 初回のみ: このディレクトリの .mise.toml を信頼
mise install                 # Node 22.22.2 / pnpm 10.33.0 が入る (バージョンは mise.toml でピン留め)
pnpm install
```

## 2. `.env` を作る

```bash
cp .env.example .env
$EDITOR .env                 # PROJECT_NAME を決める (Cloudflare アカウント内でユニーク)
```

`CF_D1_DATABASE_ID` / `CF_KV_PROFILE_CACHE_ID` / `ENCRYPTION_KEY` は後の手順で埋める。

## 3. Cloudflare にログイン

```bash
pnpm exec wrangler login
```

ブラウザが開いて OAuth 認可。

## 4. D1 を作る

```bash
pnpm d1:create
```

出力される `database_id` を `.env` の `CF_D1_DATABASE_ID` に貼る。

## 5. KV namespace を作る

LINE プロフィール・Discord ロールキャッシュ用の KV:

```bash
pnpm exec wrangler kv namespace create PROFILE_CACHE
```

出力される `id` を `.env` の `CF_KV_PROFILE_CACHE_ID` に貼る。

## 6. マスター暗号鍵を生成

```bash
pnpm keygen
```

出力された base64 文字列 (32 バイト) を `.env` の `ENCRYPTION_KEY` に貼る。**この鍵は API キー / プラットフォーム認証情報の暗号化に使う** ので、紛失すると過去の bot 登録データが全部復号できなくなる。

## 7. D1 マイグレーション

```bash
pnpm db:migrate:local        # ローカル開発用 D1
pnpm db:migrate:remote       # 本番 D1
```

マイグレーション ([`migrations/`](../migrations/)) は `0001_init.sql` → `0004_platform_discord.sql` まで順に適用される。

## 8. 初回デプロイ

Worker 自体を Cloudflare 上に作成する:

```bash
pnpm cf:deploy
```

これ以降、Cloudflare ダッシュボードに `PROJECT_NAME` の Worker が表示されるはず。

## 9. Worker Secret を投入

Worker が存在した**後で** Secret を入れる必要がある (存在しない Worker に `wrangler secret put` は失敗する):

```bash
pnpm exec wrangler secret put ENCRYPTION_KEY
# → .env の ENCRYPTION_KEY と同じ値をペースト
```

> ⚠️ Secret 投入**前**に Webhook リクエストが来ると Worker が 500 を返します。外部からアクセスされる前にここまで終えてください。

## 10. Discord を使うなら追加の Secret

Discord の Fly リレーと共有する HMAC / bearer 兼用シークレットが必要:

```bash
# 好きな値 (例: openssl rand -base64 32)
pnpm exec wrangler secret put DISCORD_RELAY_SECRET
```

同じ値を Fly 側 secret にも入れる ([discord.md](discord.md) 参照)。LINE のみ使う場合は不要。

## 11. 動作確認

```bash
curl https://<PROJECT_NAME>.<subdomain>.workers.dev/
# → "my-chat-bot" が返る
```

ここまで終われば Worker 基盤は OK。次に [line.md](line.md) か [discord.md](discord.md) で bot を追加する。

---

## 自動デプロイ (Cloudflare Workers Builds)

`main` への push で自動デプロイしたい場合:

1. 上記の手順を一度完了 (Secret 投入・初回デプロイまで)
2. [Cloudflare ダッシュボード](https://dash.cloudflare.com) → Workers & Pages → 自分の Worker → **Settings → Builds → Connect**
3. GitHub 認証 → リポジトリ → `main` ブランチ
4. Build 設定:
   - Build command: `pnpm install --frozen-lockfile && pnpm gen:config`
   - Deploy command: `pnpm exec wrangler deploy`
5. **Environment variables** に `.env` と同じ値 (`PROJECT_NAME`, `CF_D1_DATABASE_ID`, `CF_KV_PROFILE_CACHE_ID`) を追加
6. Save

これ以降 `git push origin main` で自動デプロイ。**マイグレーションは自動化していない** のでスキーマ変更時は手元で `pnpm db:migrate:remote` を実行すること。

## トラブル時

- `wrangler tail` で Worker のリアルタイムログを見られる
- `wrangler d1 execute <PROJECT_NAME> --remote --command "SELECT ..."` で本番 D1 を直接クエリできる
- マイグレーションに失敗したら `wrangler d1 migrations list <PROJECT_NAME>` で適用状況を確認
