# my-chat-bot

Cloudflare Workers で動く LLM チャット bot。1 つの Worker で複数 bot をホストし、LINE に招待して使う。

## アーキテクチャ

- Cloudflare Workers + Hono
- D1: bot 設定と会話履歴
- Durable Object: チャンネル単位のレートリミット
- KV: LINE のプロフィール・グループ情報キャッシュ (24h TTL)
- LLM: OpenAI / Anthropic / Gemini (bot ごとに選択)
- ローカルツールは **mise** で管理、**pnpm** で依存管理 (バージョン固定)

API キー・LINE Channel 認証情報は AES-GCM で暗号化して D1 に保存。マスター鍵は Worker Secret。

## 上限値 (src/config.ts で変更可)

- LLM に渡す履歴: 直近 20 件
- 保存時の 1 メッセージ文字数: 4000 で切り捨て
- ユーザー入力上限: 2000 文字 (超えたら無視)
- レートリミット: 1 チャンネル 1 分 5 件 / 1 時間 30 件

## 設定ファイルの扱い

`wrangler.toml` は **.gitignore 済み**。リポジトリには `wrangler.toml.template` だけが入っており、`PROJECT_NAME` (Worker 名 & D1 名) と `CF_D1_DATABASE_ID` は `.env` から環境変数経由で埋め込む。`pnpm` スクリプト経由で wrangler を呼ぶと自動で `wrangler.toml` を生成する (`pnpm gen:config`)。

これにより **clone した人はそれぞれの `.env` だけ書けば自分の Cloudflare アカウント・D1・Worker 名で動かせる**。

## 初期セットアップ

Node/pnpm のバージョンは `mise.toml` で固定 (Node 22.22.2 / pnpm 10.33.0)。

```bash
# 初回のみ: mise にこのディレクトリの設定を信頼させる
mise trust

# 固定バージョンの Node と pnpm をインストール
mise install

# 依存インストール
pnpm install

# .env を作成して Worker 名を決める (PROJECT_NAME はエディタで編集)
cp .env.example .env

# Cloudflare にログイン (ブラウザが開く)
pnpm exec wrangler login

# D1 作成。出力される database_id を .env の CF_D1_DATABASE_ID に貼る
pnpm d1:create

# KV namespace 作成 (LINE プロフィール等の 24h キャッシュ)。id を .env の CF_KV_PROFILE_CACHE_ID に貼る
pnpm exec wrangler kv namespace create PROFILE_CACHE

# マスター暗号鍵生成。出力を .env の ENCRYPTION_KEY にも貼る
pnpm keygen

# マイグレーション
pnpm db:migrate:local
pnpm db:migrate:remote

# 初回デプロイ (この時点で Worker が作成される)
pnpm cf:deploy

# Worker Secret として暗号鍵を投入 (← Worker が存在した後でないと失敗する)
pnpm exec wrangler secret put ENCRYPTION_KEY
# → .env の ENCRYPTION_KEY と同じ値を貼り付け

# Bot 登録は LINE セクション参照
```

> Secret を入れる前に Webhook に対するリクエストが来ると Worker が 500 になります。Secret 投入直後のリクエストから正常応答します。

## 自動デプロイ (Cloudflare Workers Builds)

`main` への push で自動デプロイしたい場合:

1. 上記の初期セットアップを一度完了させておく (D1/Secret/初回デプロイまで)
2. [Cloudflare ダッシュボード](https://dash.cloudflare.com) → Workers & Pages → 自分の Worker → **Settings → Builds → Connect**
3. GitHub 認証 → リポジトリ → `main` ブランチ
4. Build 設定:
   - Build command: `pnpm install --frozen-lockfile && pnpm gen:config`
   - Deploy command: `pnpm exec wrangler deploy`
5. **Environment variables** に `PROJECT_NAME`, `CF_D1_DATABASE_ID`, `CF_KV_PROFILE_CACHE_ID` を追加 (ローカル `.env` と同じ値)
6. Save

これ以降は `git push origin main` するだけでデプロイされる。マイグレーション (`pnpm db:migrate:remote`) は自動化していないので、スキーマ変更時は手元で実行する。

## LINE bot を追加

1. [LINE Developers](https://developers.line.biz/) で Messaging API チャネルを作成
2. チャネル基本設定から **Channel secret** を取得
3. Messaging API 設定から **Channel access token** を発行
4. 使いたい LLM プロバイダの API キーを用意 (OpenAI / Anthropic / Gemini のうち 1 つ以上。複数あれば全部登録してモデル変更だけで切り替え可能)
5. Bot を登録:

   ```bash
   pnpm bot:create --remote
   ```

   Bot 名、デフォルトモデル、システムプロンプト、各プロバイダの API キー (空欄スキップ可)、LINE Channel secret/access token を対話的に入力。最後に bot の ID と Webhook URL が表示される。

6. LINE Developers Console の **Webhook URL** に表示された URL を設定:
   `https://<your-worker>.workers.dev/webhook/line/<bot-id>`
7. Webhook の利用を **オン**、応答メッセージを **オフ** にする
8. グループでメンションさせる場合は `Allow bot to join group chats` を有効化

### モデル (プロバイダ) を切り替える

Bot は複数プロバイダの API キーを保持できる。使用するモデルを変えるとプロバイダは `model` 名から自動判別される (`gpt-*`/`o1*`/`o3*`/`o4*` → openai、`claude-*` → anthropic、`gemini-*` → gemini)。

```bash
# モデル変更 (例: Claude → Gemini)
pnpm bot:edit <bot-id> --model=gemini-2.5-flash --remote

# 後からキー追加
pnpm bot:set-key <bot-id> gemini --remote
```

## 運用

- `pnpm bot:list --remote` で一覧 (登録済みプロバイダも表示)
- `pnpm bot:edit <bot-id> --model=<model>` でモデル変更
- `pnpm bot:set-key <bot-id> <provider>` で API キー追加/更新
- `pnpm bot:delete --remote` で削除 (履歴・キー・プラットフォーム設定も全部削除)
- ローカル検証は `--remote` を外すと D1 local バックエンドを使用

## 仕様

- **応答条件**: DM または自分宛メンションのみ
- **履歴**: チャンネルごとに無期限保存
- **無限ループ対策**: レートリミット (silent drop) + 自分宛メンションのみ応答
- **コンテキスト注入**: LLM 呼び出し時にシステムプロンプト末尾に Bot 名 / 会話形態 / グループ名 / 参加メンバー名を自動付与 (KV で 24h キャッシュ)
- **プラットフォーム拡張**: Discord / Slack は今後対応予定

## ディレクトリ構成

```
src/
  index.ts              Hono エントリ
  config.ts             上限値定数
  env.ts                Worker bindings の型
  crypto.ts             AES-GCM 暗号化
  rate-limit.ts         Durable Object (RateLimiter)
  types.ts              共通型
  llm/                  OpenAI / Anthropic / Gemini (プロバイダ自動判別)
  platforms/line/       LINE の webhook/verify/client/profile (KV キャッシュ)
  repository/           D1 アクセス
migrations/             D1 スキーマ
scripts/                bot 登録/一覧/削除 CLI
```
