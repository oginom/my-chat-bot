# LINE bot

[setup.md](setup.md) のワーカー構築が終わっている前提。

## 1. LINE Developers Console で Messaging API チャネルを作る

1. <https://developers.line.biz/console/> にログイン
2. 「Create a new provider」(初めてなら) → 「Create a new channel」→ **Messaging API**
3. 作成後、**Basic settings** タブで以下をメモ:
   - **Channel secret** (認証用)
4. **Messaging API** タブで:
   - **Channel access token** を発行 (Issue ボタン) してメモ
   - (後で使う) **Webhook URL** と **Allow bot to join group chats** の設定

## 2. LLM プロバイダの API キーを用意

使いたい LLM プロバイダの API キーを手元に用意:

- OpenAI: <https://platform.openai.com/api-keys>
- Anthropic: <https://console.anthropic.com/settings/keys>
- Gemini: <https://aistudio.google.com/apikey>

複数登録してもよく、モデル名を切り替えるだけでプロバイダが入れ替わる ([operations.md](operations.md) 参照)。

## 3. Bot を登録

```bash
pnpm bot:create --remote
```

対話的プロンプト:

| 項目 | 例 |
|---|---|
| Bot name | `キリンボット` |
| Default model | `gpt-4o-mini` / `claude-sonnet-4-6` / `gemini-2.5-flash` |
| System prompt | bot の振る舞いを規定する文章 |
| `openai` / `anthropic` / `gemini` API key | 必要なプロバイダの API キー (スキップ可、選んだ model と一致するものは必須) |
| Platforms | `line` (Discord と両方なら `line,discord`) |
| LINE Channel secret | 手順 1 でメモした値 |
| LINE Channel access token | 手順 1 でメモした値 |

最後に bot の UUID と Webhook URL が表示される。

### 既存 bot に LINE を追加する場合

Discord 用に作った bot に LINE も追加する、みたいな場合は:

```bash
pnpm bot:list --remote           # bot-id を確認
pnpm bot:add-platform <bot-id> line --remote
```

LINE Channel secret / access token を入力。

## 4. LINE Developers Console で Webhook 設定

1. **Messaging API** タブ → **Webhook URL** に表示された URL を設定:
   ```
   https://<your-worker>.<subdomain>.workers.dev/webhook/line/<bot-id>
   ```
2. **Use webhook** を ON
3. **Auto-reply messages** と **Greeting messages** は OFF (bot ロジックと干渉するので)
4. グループ / ルームで使う場合は **Allow bot to join group chats** を ON

## 5. 動作確認

- LINE で bot を友達追加 → 1:1 で話しかける → 返事が返ってくるか確認
- グループに bot を招待 → 他のユーザーが発言しても bot は反応しない (履歴には残る) → bot をメンションして発言すると返事
- `clear` と送信 (グループではメンション + `clear`) → 「会話履歴をリセットしました。」が返る

## LINE 固有の振る舞い

### 応答条件

- **DM (1:1)**: 常に応答
- **グループ / ルーム**: **bot 宛のメンションが含まれている時だけ** 応答
  - LINE API の `mention.mentionees[].userId` に bot の userId が含まれているかで判定

### メッセージ保存

- 全発言を保存する (メンション有無に関わらず)
- グループ / ルームでは発話者の LINE 表示名を `"<名前>: <本文>"` の形で prefix
- DM は prefix なし (1:1 なので発話者が明らか)

保存されたメッセージは次に bot がメンションされた時、LLM の履歴として最新 20 件が渡される。

### コンテキスト注入

システムプロンプトの末尾に自動付与される情報:

- Bot 自身の LINE 表示名 (KV キャッシュ、`/v2/bot/info` から)
- 会話形態: 1:1 DM / グループ / 複数人トーク (ルーム)
- グループの場合: グループ名 + 参加メンバーの LINE 表示名一覧 (KV キャッシュ、24h TTL)
- ルームの場合: 参加メンバー一覧

グループ名や参加メンバー情報は `/v2/bot/group/{id}/...` / `/v2/bot/room/{id}/...` から取得。詳細: [`src/platforms/line/profile.ts`](../src/platforms/line/profile.ts)。

### プラットフォームディレクティブ

LLM に「LINE は Markdown をレンダリングしないのでプレーンテキストで」「不要ならユーザー名 / グループ名を返事に入れない」と指示が入る ([`src/platforms/line/webhook.ts`](../src/platforms/line/webhook.ts) の `PLATFORM_DIRECTIVES`)。

## トラブルシューティング

| 症状 | 見る場所 |
|---|---|
| Webhook を受けたが bot が無応答 | LINE Developers Console の Webhook 検証・`Auto-reply` が ON になっていないか |
| 署名検証で 401 が返る | `pnpm bot:list --remote` で platform 登録を確認。Channel secret が正しいか |
| 返信だけ来ない | `pnpm exec wrangler tail` で LLM エラーを確認。API キー登録有無も |
| 500 が返る | `ENCRYPTION_KEY` Secret が Worker に設定されているか |

`wrangler tail` は Worker の全リクエストログが見られるので最初にここを確認。

## 制約・既知の挙動

- LINE の `replyToken` は **1 回しか使えない** し発行から**約 1 分**で失効する。LLM 呼び出しが 1 分超える場合は返信失敗する (基本のモデルでは起こらない)
- プッシュ通知 (メッセージをこちらから送る) は未実装
- 画像・スタンプ・その他非テキストメッセージは保存も応答もしない (スキップ)
