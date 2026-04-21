# my-chat-bot

Cloudflare Workers で動く LLM チャット bot。1 つの Worker で複数 bot をホストし、LINE に招待して使う。

## アーキテクチャ

- Cloudflare Workers + Hono
- D1: bot 設定と会話履歴
- Durable Object: チャンネル単位のレートリミット
- LLM: OpenAI / Anthropic / Gemini (bot ごとに選択)
- ローカルツールは **mise** で管理、**pnpm** で依存管理 (バージョン固定)

API キー・LINE Channel 認証情報は AES-GCM で暗号化して D1 に保存。マスター鍵は Worker Secret。

## 上限値 (src/config.ts で変更可)

- LLM に渡す履歴: 直近 20 件
- 保存時の 1 メッセージ文字数: 4000 で切り捨て
- ユーザー入力上限: 2000 文字 (超えたら無視)
- レートリミット: 1 チャンネル 1 分 5 件 / 1 時間 30 件

## 初期セットアップ

Node/pnpm のバージョンは `mise.toml` で固定 (Node 22.22.2 / pnpm 10.33.0)。`package.json` の `packageManager` / `engines` も同じ値で揃えている。

```bash
# 初回のみ: mise にこのディレクトリの設定を信頼させる
mise trust

# 固定バージョンの Node と pnpm をインストール
mise install

# 依存インストール
pnpm install

# D1 データベース作成 (出力される database_id を wrangler.toml に貼る)
pnpm exec wrangler d1 create my-chat-bot

# マイグレーション (ローカル + リモート両方)
pnpm db:migrate:local
pnpm db:migrate:remote

# マスター暗号鍵生成。出力を控える
pnpm keygen

# Worker 側にセット
pnpm exec wrangler secret put ENCRYPTION_KEY
# → 上で出た base64 文字列を貼り付け

# CLI からも使うのでシェルにもエクスポート (keygen の出力をコピー)
export ENCRYPTION_KEY='...'

# デプロイ
pnpm deploy
```

## LINE bot を追加

1. [LINE Developers](https://developers.line.biz/) で Messaging API チャネルを作成
2. チャネル基本設定から **Channel secret** を取得
3. Messaging API 設定から **Channel access token** を発行
4. 以下で bot を登録:

   ```bash
   pnpm bot:create --remote
   ```

   プロバイダ・モデル・システムプロンプト・各種 API キーを対話的に入力。最後に bot の ID と Webhook URL が表示される。

5. LINE Developers Console の **Webhook URL** に表示された URL を設定:
   `https://<your-worker>.workers.dev/webhook/line/<bot-id>`
6. Webhook の利用を **オン**、応答メッセージを **オフ** にする
7. グループでメンションさせる場合は `Allow bot to join group chats` を有効化

## 運用

- `pnpm bot:list --remote` で一覧
- `pnpm bot:delete --remote` で削除 (履歴も CASCADE で削除)
- ローカル検証は `--remote` を外すと D1 local バックエンドを使用

## 仕様

- **応答条件**: DM または自分宛メンションのみ
- **履歴**: チャンネルごとに無期限保存
- **無限ループ対策**: レートリミット (silent drop) + 自分宛メンションのみ応答
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
  llm/                  OpenAI / Anthropic / Gemini
  platforms/line/       LINE の webhook/verify/client
  repository/           D1 アクセス
migrations/             D1 スキーマ
scripts/                bot 登録/一覧/削除 CLI
```
