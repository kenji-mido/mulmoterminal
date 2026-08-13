# feat(#1173): `/prs` の issue 行から worktree ＋ セッションを起こす

#1026 の段階3。段階1（`issue/<N>-<slug>` のブランチ）と段階2（repo → clone の逆引き）を繋いで、
**issue 行のボタン1つで、そのリポのクローンに worktree を作り、issue 本文を入力欄に入れた
Claude セッションをグリッドに出す**。

## 設計を1点変える — `pasteText` ではなく spawn 時の `draft`

#1026 で「本文は `pasteText` で貼るだけ・送信しない」と決めたが、**貼る方法は使えない**。
`server/session/draft-injection.ts` にこうある:

> Claude must have its input box + bracketed-paste mode up before it will capture a typed
> `draft`; **too early and the bytes are echoed into the scrollback instead**.

セルを起こした直後にクライアントから貼ると、TUI の起動レースに負けてテキストは
**スクロールバックに消える**（押したのに何も起きない、という一番たちの悪い壊れ方）。
`useSpawnedChat` の設計コメントも同じことを言っている — 「a plain claude cell has no channel
to be handed a prompt」。

**決定事項（送信しない）はそのまま。** 変えるのは手段だけ:

- サーバが worktree の中に claude セッションを spawn し、`draft: <issue 本文>` を渡す
- `attachDraftInjection` が **TUI の readiness marker を待ってから**入力欄にタイプする。Enter は打たない
- 制御バイトは `sanitizeDraftText` が落とす。issue 本文は**他人が書いた**テキストなので、
  これはセキュリティ上も必要（bracketed paste を抜け出すシーケンスを弾く）
- クライアントは `placeSpawnedChat({ id, agent, draft: true })` でグリッドのセルとして出す

つまり `startCollectionChat` が既に通っている道と同じで、違うのは **cwd が worktree** であることだけ。

### その「既に通っている道」が、作りたての worktree では通らなかった

実機で流して `tmux capture-pane` で画面を見て分かったこと。ユニットテストでは一切出ない。

1. **drift フォールバックが「spawn から 6 秒」だった。** 作りたての worktree で claude が入力欄まで
   到達するのに 6 秒以上かかるので、**描画途中の画面に paste して `done` を立てて**しまい、
   入力欄ができる前に本文が消えていた。既存の呼び出し元（collection プラグイン）は
   温まった信頼済み cwd で spawn するので、この窓に当たったことがなかった。
   → **経過時間ではなく「無音が続いた時間」で待つ**ように変更（`attachCodexAutoRun` と同じ考え方）。
2. **trust ダイアログは無音の画面**なので、無音待ちだとそこに paste してしまう。
   → ダイアログを見つけたら**待ち時間を大幅に延ばす**（60 秒）。無限に待たないのは、
   ダイアログを答えると**ダイアログの再描画と新しい画面が 1 バーストで来て**、その後は
   画面が止まるため — 「消えた証拠」を待つ実装は**一度も打たなかった**（実機で確認）。
3. **`draftReadyMarker`（`/shift\+tab to cycle/`）はモード依存**。v2.1.220 の manual モードの
   ステータス行は `? for shortcuts` で、マーカーは一度も出ない。無音待ちがこれも救う。

## 実装

### 1. `POST /api/issues/start`（サーバ）

`{ repo, issue, dir }` を受け、1リクエストで:

1. `gh issue view <n> --repo <repo> --json number,title,body` で**本文を取得**（一覧は今も軽いまま）
2. `createWorktree(dir, <title>, issue)` → `issue/<N>-<slug>`（段階1）
3. worktree を cwd に claude を spawn、`draft` に seed テキスト
4. `{ sessionId, agent, worktree, branch }` を返す

**1リクエストにまとめる理由**: クライアントが3回叩くと、worktree はできたが spawn は失敗、
という中途半端な状態を UI 側で始末することになる。サーバ側なら失敗時に何も残さない。

`dir` はリクエスト由来なので、**段階2 の逆引きが候補として挙げたディレクトリであることを検証**する。
任意のパスを spawn の cwd にできてはいけない。

### 2. `/prs` の issue 行（クライアント）

- `/api/repo-dirs` を読み、リポごとに clone の有無と候補を知る
- clone が無いリポ（`graphai` 等）はボタンを**無効化して理由を出す**
- primary が記録済み、または候補が1つ → 1クリックで起動
- 候補が複数で未記録 → クローンを選ぶメニュー。選んだら `repoDirs` に記録して起動

## テスト

- 本文取得の正常系 / `gh` 失敗
- `dir` が候補に無ければ 403（任意パスを spawn させない）
- worktree 作成失敗時に spawn しない
- 行の状態: clone 無し → 無効＋理由 / primary あり → 1クリック / 複数未記録 → メニュー

## やらないこと

- 本文のプレビュー表示（起動時に取るだけ）
- マージ / issue クローズ / 片付け（#1026 段階3の後半。別 issue に切る）
