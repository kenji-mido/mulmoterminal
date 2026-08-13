# feat: Antigravity の会話を cwd 単位で一覧する API (#1096 の残り ③)

#1096 の①②（会話マッピングの永続化 / cold resume）は #1157 で着地済み。
残っていた ③ `GET /api/antigravity/sessions?cwd=` をここで入れる。

**④（`fetchAntigravitySessions()` のクライアント合流）は入れない。** 実装して検証したうえで
オーナー判断により取り下げた。理由は下の「④ を入れない理由」を参照。

## なぜ止まっていたか、なぜ今動かせるか

#1157 の時点では `agy` が未インストールで、タイトルの取得元とされた
`brain/<id>/.system_generated/logs/transcript.jsonl` の実フォーマットが確認できなかった。
推測で JSONL パーサを書くのを避けて据え置いた。

agy 1.1.9 を入れて実データで確認した。会話3件（対話モード / `-p` print モード、1行 / 複数行、
別 cwd）で以下が一致する。

```jsonc
{ "step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT",
  "status": "DONE", "created_at": "2026-08-01T09:16:59Z", "content": "..." }
```

- `type` は実測で `USER_INPUT` / `CONVERSATION_HISTORY` / `PLANNER_RESPONSE` / `CHECKPOINT`。
- **`content` は生のユーザー入力ではない。** `<USER_REQUEST>\n…\n</USER_REQUEST>` で包まれ、
  後ろに `<ADDITIONAL_METADATA>`（ローカル時刻）と `<USER_SETTINGS_CHANGE>`（モデル変更の説明文）
  が続く。そのまま使うとタイトルが
  `<USER_REQUEST> hello </USER_REQUEST> The current local time is…` になる。
- `content` が無い行がある（`CONVERSATION_HISTORY`）。`.content` 前提のパーサは落ちる。
- `created_at` は ISO-8601 UTC。

## cwd は自前ログのまま（issue の前提は現行版では古いが、結論は変わらない）

issue は「agy は cwd を記録しないので MulmoTerminal 側が持つしかない」としているが、
agy 1.1.9 は記録している。ただし調べた4箇所とも「cwd から全会話を引く」用途には使えない。

| 保存先 | cwd | title | cwd で全会話を引けるか |
|---|---|---|---|
| `cache/last_conversations.json` | あり（キー） | なし | 不可 — cwd ごとに最後の1件だけ。しかも**セッション終了時に書かれる**（実行中の会話は載らないことを実測） |
| `conversations/<id>.db` の `trajectory_metadata_blob` | あり（`file://` URI + git remote/branch） | — | 可だが protobuf 解析が要る |
| `history.jsonl` | あり（`workspace`） | あり（`display`） | 不可 — conversation id が無い。print モードでは追記されない |
| `conversation_summaries.db` | `workspace_uris` 列あり | `title` 列あり | **CLI が書かない**（IDE 由来の行だけ） |

よって cwd の出所は #1157 で入った `~/.mulmoterminal/antigravity-conversations.jsonl` のまま。
transcript はタイトルと mtime のためだけに読む。

## 実測で決めた挙動

- **最初のユーザー入力があるまで brain ディレクトリは作られない**（tmux で agy を起動して 12 秒
  放置し、ディレクトリが増えないことを確認）。入力を送った直後に
  ディレクトリと transcript が両方できる。よって「ディレクトリはあるが transcript が無い」は
  agy が作る状態ではない。
- それでも transcript が読めない行を**落とさず**、会話ディレクトリが存在する限り既定タイトルで
  残す。agy が transcript の位置を変えたときに一覧が黙って全滅するより、名前が既定に落ちる方が
  マシで、この issue の目的（見つけられること・再開できること）は満たせる。

## 変更

### server

- `server/agents/antigravity-sessions.ts`（新規、`codex-sessions.ts` と対）
  - `antigravityTranscriptPath(root, id)`
  - `antigravityTitleFromTranscriptHead(head)` — 先頭 64KB から最初の `USER_INPUT` を拾い、
    `<USER_REQUEST>` の中身だけを取る。ラッパーが無い形式に変わった場合は既知のメタデータ
    ブロックだけ落として残りを使う。
  - `listAntigravitySessions(root, records, cwd, limit)` — 自前ログのレコードを cwd で絞り、
    conversationId で重複排除し、実在するものだけを transcript の title/mtime 付きで返す。
- `server/agents/antigravity-session.ts` の `listAntigravitySessions` を
  **`listAntigravityConversationIds` に改名**。新旧で名前が衝突するため。codex 側も
  singular は `listRecentRollouts`（エージェント自身の名詞）、plural が `listCodexSessions` に
  なっていて、その対応に揃える。
- `server/routes/session-routes.ts` に `GET /api/antigravity/sessions` を追加。
  `/api/codex/sessions` と同じ形（`?cwd=`、既定は `CLAUDE_CWD`、`{ cwd, sessions }`）。
  codex と違い **`await antigravityConversationsHydrated` が要る** — 起動直後のリクエストが
  ハイドレート前の空マップを見ると、一覧が空で返ってしまう。

### client

変更なし。理由は次節。

## ④ を入れない理由

issue の④は「サイドバーの一覧に合流させる」ものだが、**その単一ビューと `Sidebar.vue` は
#1201 / #1202 で削除済み**（4.0.0）。現在 `useSessions()` の利用者は `App.vue` の1箇所だけで、
用途はファビコンの色のみ。つまり④を入れても見えるものは何も変わらない。

これは agy 固有ではなく codex も同じ状態で、`/api/codex/sessions` の結果もどの一覧にも出ていない。

| UI | 出所 | codex / agy を含むか |
|---|---|---|
| ランチャーの "or resume here" | `/api/sessions?cwd=` のみ | 含まない |
| コックピット・ロスター | グリッドのセル | 含まない |
| ファビコン | `useSessions()` | 含む（唯一の利用者） |

見える導線を作るならランチャーの resume 一覧が候補だが、codex の挙動も変わるためこの issue の
範囲外。API（③）だけ先に入れておけば、一覧 UI を作るときに agy がそのまま乗る。

**一覧 UI を作る人への申し送り**: `useFaviconState.ts:69` は権威リストの `working:false` で
ライブの活動状態を上書きする。一覧から会話を再開すると conversation id がセッションキーになる
ため、実行中セッションのファビコンが idle に戻り得る。いま一覧 UI が無いので到達不能だが、
UI を戻した時点で顕在化する（codex も同様）。

## テスト

- `test/server/agents/antigravity-sessions.spec.ts`
  - `<USER_REQUEST>` の中身だけがタイトルになる（メタデータが混ざらない）
  - 複数行プロンプトが1行に畳まれる / 60文字で切られる
  - `content` の無い行、壊れた行、途中で切れた最終行を飛ばす
  - ラッパーが無い content でもメタデータブロックだけ落として使う
  - `USER_INPUT` が無ければ既定タイトル
  - cwd で絞る / conversationId で重複排除 / 実在しない会話を落とす / mtime 降順 / limit
  - transcript が読めない会話はディレクトリがある限り既定タイトル + `startedAt` で残る
- 既存 `test/server/agents/antigravity-session.spec.ts` は改名に追従。

## やらないこと

- codex の `codexRolloutIds` もメモリのみで同じ再起動制約がある（#1157 のコメント参照）が、
  この issue は antigravity 限定なのでスコープ外。
