# feat #1096 — Antigravity の会話ログを永続化し、cold resume を再起動後も効かせる

Issue #1096 の 4 項目のうち **①②④** を対象とする。③（`GET /api/antigravity/sessions`）は
別 PR に回す。理由は「やらないこと」に書く。

## 背景

`antigravityConversationIds`（`server/session/registry.ts`）はメモリ上の `Map` だけなので、
サーバを再起動すると「MulmoTerminal のセッションキー → agy の会話 id」の対応が消える。
`resolveAntigravitySession`（`server/routes/ws-routes.ts`）はその Map を見ているため、
再起動後は resume id を得られず、会話に戻れない。

安全側には倒れている。`agentResumeId` は `mappedId` が無いとき「キー自体が会話 id か」を
`antigravityConversationExists()` で確かめてからでないと resume しないので、対応が失われても
**古い id を `agy --conversation` に渡してしまうことはない**。失われるのは会話への到達手段だけ。

## やること

### ① 会話ログ（append-only）

新規 `server/session/antigravity-conversations.ts`。既存の `session-memos.ts` と同じ形にする
（`~/.mulmoterminal` は同一マシンの全インスタンス・全バージョンで共有されるため、
読んで書き戻すスナップショットではなく追記ログにする、という既存の理由がそのまま当てはまる）。

- レコード: `{ sessionId, conversationId, cwd, startedAt }`
- 1 行 1 JSON オブジェクト（`session-memos.jsonl` と同じ）。`cwd` に空白が入りうるので、
  `dev-terminal-cwds` の `<id> <path>` 形式は使えない。
- 同じ `sessionId` の**後の行が勝つ**（セルを別ディレクトリで起動し直せる）。
- 保存先: `~/.mulmoterminal/antigravity-conversations.jsonl`。既存ログを広げず新ファイルにするのは
  `dev-terminal-cwds.ts` が挙げている理由と同じ — 古いビルドのパーサが行を落とすのを避ける。

`registry.ts` 側:

- `antigravityConversationIds: Map<string, string>` を
  `antigravityConversations: Map<string, AntigravityConversation>` に置き換える。
  **メモリの Map をログの投影にする**ことで、参照元が 2 つに割れるのを防ぐ（②がほぼ自明になる）。
- `antigravityConversationsHydrated` を公開。読み出しは `forEachJsonlRecord`（ストリーム）で、
  ファイル全体を 1 つの文字列にしない。
- `rememberAntigravityConversation(sessionId, conversationId, cwd)` を公開。
  同じ内容なら追記しない（ログをむやみに伸ばさない）。
- **この起動中に自分が書いた `sessionId` は hydrate で上書きしない**。hydrate は自分の追記が
  届く前のファイルを読むので、上書きすると古い cwd で答えてしまう（`session-memos.ts` の
  `memoWrittenIds` と同じ罠）。

書き込み点は `server/session/spawn-antigravity.ts` の 2 箇所:

1. spawn watcher が会話 id を確定したとき（新規セッション）
2. resume で id が既知のとき（サイドバー等から会話 id そのものを渡された場合を含む）

### ② `resolveAntigravitySession` がログを見る

- `mappedId` を `antigravityConversations.get(requested)?.conversationId` から取る。
- `handleAntigravityConnection` の中で `resolveAntigravitySession` を呼ぶ**前に**
  `await antigravityConversationsHydrated` する。これを忘れると、hydrate 完了前に届いた
  再接続が空の Map を見て resume を諦める（`devTerminalCwdsHydrated` と同じ理由）。

### ④ クライアント側の型とバッジ

- `Session.agent` を `"codex"` リテラルから `TerminalAgent` に広げる（`common/sessionAgent.ts`）。
- `common/sessionAgent.ts` に `agentBadge()` を足し、バッジ文言の唯一の出所にする。
  claude は既定なのでバッジ無し（ほぼ全行に付いてしまう）、`shell` も対象外。
- ハードコードされた `agent === 'codex'` を 3 箇所差し替える:
  `Sidebar.vue` / `SessionTabBar.vue`（同じ `Session[]` を見る縦横 2 つのビュー。片方だけ直すと
  同じ一覧が食い違う）と `CockpitHeader.vue`（ロスターは別データ源だが、#1089 でセルが agent を
  持つようになった以上、agy のセルだけ無印なのは不整合）。

## テスト方針（動作テストなしで担保できる範囲）

`agy` はこの開発機に無く、実際の `agy --conversation <id>` の復元は確認できない。ただし
**今回変えるのは「resume id をどこから取るか」だけ**で、渡したあとの経路は #1095 のまま。
かつ `agentResumeId` の `conversationExists()` ガードが残るので、ログが壊れていても最悪ケースは
「resume しない」に縮退し、別の会話に接続することはない。この前提でユニットテストに寄せる。

- `test/server/session/antigravity-conversations.spec.ts`
  - 行のラウンドトリップ、同一 sessionId の後勝ち、空白入り cwd
  - 壊れた行 / 別ログの行 / 途中で切れた最終行を落とす
  - hydrate が「この起動中に書いた分」を上書きしない
- `test/common/agentBadge.spec.ts`
  - claude と shell と未知の値はバッジ無し、codex / antigravity は文言つき

## やらないこと（この PR の範囲外）

- ③ `GET /api/antigravity/sessions` — ルート自体は①のログから cwd で引けるので容易だが、
  タイトルの取得元とされる `brain/<id>/.system_generated/logs/transcript.jsonl` の実フォーマットが
  **この環境では確認できない**（`agy` 未インストール、リポジトリ内にフィクスチャも記述も無い）。
  推測で JSONL パーサを書くのは避ける。
- ④ の `fetchAntigravitySessions()` — ③のエンドポイントが無いと 404 を握って空配列を返すだけの
  死にコードになる。③と同じ PR に置く。
