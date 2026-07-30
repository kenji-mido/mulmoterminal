# refactor: TerminalCell.vue から起動フォームを切り出す (#1122)

`src/components/TerminalCell.vue`（2020 行 / max-lines 換算 1605）から、空セルの**起動フォーム**を
`CellLaunchForm.vue` に切り出す。あわせて、切り出すと 1 ファイルに並んで見えるようになる重複
（ディレクトリ単位のリスト取得 3 本 + `RunMenu.vue` の 4 本目）を composable にまとめる。

## 何を切るか — 境界は既にテンプレートにある

このコンポーネントは排他的な 2 状態を描いている。`v-if="launched"`（動いているターミナル）と
`v-else data-testid="cell-launch"`（起動フォーム）で、**後者だけが使う script が約 400 行**ある。
切るのはこの `v-else` の側だけで、動いているセルの chrome（ヘッダのチップ、diff パネル、close
確認、handoff メニュー、memo）は今回触らない。

## 分割後のファイル

| ファイル | 中身 |
| --- | --- |
| `src/components/TerminalCell.vue` | 動いているセル + フォームの**器**（下記の「親に残すもの」） |
| `src/components/CellLaunchForm.vue` | 起動フォームの全テンプレートと、フォームだけが持つ状態 |
| `src/components/LaunchChipList.vue` | 「or run a script」/「or launch」の同一チップ列（重複 2 箇所） |
| `src/composables/useDirLists.ts` | dir 単位の resume / scripts / worktrees リスト取得 |
| `src/composables/useMcpToolGroups.ts` | GUI tool group スイッチの状態・書き込み・worktree への同期 |

`src/components/` はフラットな 100 ファイル超で、関連する `launchDir.ts` / `launchTargets.ts` /
`launchers.ts` / `LauncherCell.vue` も全部そこにある。2 ファイル増やすためにサブディレクトリを
切ると、関連 5 ファイルだけ外に残って探しにくくなるのでフラットのまま置く（#1126 の
`settings/` は 17 ファイルだったので事情が違う）。

## 親に残すもの — 「フォームが決めて、セルが持ち続ける」3 つ

フォームは launch した瞬間に unmount される。**launch 後も使う値**と、**閉じた後に復元する値**は
親が持たないと消えるので、次の 3 つは親のままにして prop + emit で降ろす:

1. **`launchTarget`**（Claude / Codex / Antigravity / Shell）— `agent` computed の出どころで、
   launch 後の WS エンドポイントを決める。
2. **`launchChoice`**（ModelPicker）— `TerminalView :launch` に渡る。「同じセルで起動し直したら
   同じ選択を繰り返す」ためにセルの寿命ぶん保持する、と既にコメントで宣言されている。
3. **`dirInput` / `dirTouched`** — `teardown()` が **`defaultCwd` に戻す**のが仕様
   （「閉じたセッションのディレクトリがフォームに残る」のを防ぐ）。子が自前で初期化すると
   `preferredLaunchDir()` になり、**直前に閉じたディレクトリが preset 先頭として戻ってくる** ——
   teardown のコメントがまさに避けたいと言っている状態になる。late-arriving preset の同期
   （`shouldSyncLaunchDir`）も `initialCwd` / `touched` を見るので親に置く。

`dir` は `:dir` + `@update:dir` で渡す。`dirTouched = true` は親の `update:dir` ハンドラでまとめて
立てる（入力・chip・フォルダピッカーのどれも update:dir を通る）。

## 子が持つもの

- preset チップ（`useDirColors` / `useDirPriorities` / `orderByDirPriority` / 実行中の色分け）
- 300ms デバウンスの dir 変更 watch と `skipDirWatch`（fillDir が即ロードしたぶんを飲む）
- resume 一覧 / script 一覧 / worktree 一覧（→ `useDirLists`）
- GUI tool group スイッチ（→ `useMcpToolGroups`）
- worktree の作成・再利用・削除、`pickDir`

子 → 親の emit:

| emit | 親の処理 |
| --- | --- |
| `start(dir)` | `startTarget(dir)`（shell なら `launch` を上へ、そうでなければ `launchIn`） |
| `resume({ id, cwd })` | セッション id と cwd を確定して `launched = true` |
| `update:dir` / `update:target` / `update:choice` | 上記 3 つの状態を更新 |
| `run` / `launch` / `remove-preset` / `close` | grid へそのまま再 emit |

「他のセルで開いているセッションか」の確認ダイアログは**子**に置く。クリックされた行の title を
そのまま使え、フォームが出ている間は `sessionId` が常に null（= 判定は `openSessionIds` だけ）
なので、親から降ろすものが 1 つ減る。

`onMounted` の 4 本のロード（resumable / scripts / worktrees / mcp groups）と、`teardown()` が
同じ 4 本を呼び直している行は**どちらも消える**。フォームは `v-else` なので、閉じれば新しい
インスタンスがマウントされて自分の `onMounted` が走る。

## 重複の解消

### `useDirLists.ts` — dir 単位リスト取得の 3 + 1 箇所

`loadResumable` / `loadScripts` / `loadWorktrees` は**同一の型**をしている: リクエストトークンを
採番 → dir が無ければ空にして戻る → fetch → await の前後 2 回トークンを確認 → 失敗したら空に戻す。
`RunMenu.vue` の `loadScripts` が 4 本目で、こちらは script 一覧そのものを共有できる。

共有するのは「トークン付きの 1 リスト」だけにして、URL とパースは各リストが持つ。戻り値は
`{ value, load }` の 1 オブジェクト（`resumable.sessions` / `worktrees.list` のように読む）。

### `LaunchChipList.vue` — 「or run a script」と「or launch」

見出し + 同一クラスのチップ列が 2 回。違うのはアイコン（`play_arrow` / `rocket_launch`）と
`title` だけ。`data-testid="cell-script-item"` は両方とも今のままにする（spec が選んでいる）。

## テスト

`TerminalCell.spec.ts`（2276 行）は全部 DOM 経由（`mount` して testid で探し、`w.emitted()` を
見る）なので、**子を stub せずに mount している限りセレクタは無改変で通る**。ここを緑のまま
保つのがこの refactor の合否条件。

新規に追加するもの:

- `useDirLists` — 順序が入れ替わった応答を捨てる / 失敗時に空へ戻す / dir 無しで空
- `useMcpToolGroups` — `syncInto` が**差分のあるグループだけ**書くこと、読めなければ全部書くこと

### DOM が変わっていないことは spec では足りない

#1126 と同じやり方で確認する: 分割前の `TerminalCell.vue` を `TerminalCellBeforeSplit.vue` として
一時的に併置し、同じ props で両方を mount して `html()` を直接 diff する（使い捨て、コミット
しない）。条件は起動フォームの分岐を振る: preset 有無 / git repo / worktree 一覧 / script 一覧 /
launcher 一覧 / resume 一覧（他セルで開いている行を含む） / MCP グループの ON・OFF / shell 選択 /
cancellable。

### 実測結果

11 条件のうち **10 条件で DOM 完全一致**（HTML コメントのインデントのみ差分。コメントは描画されない
ので無害）。残る 1 条件が唯一の挙動変化:

**セルを閉じた直後、GUI tool group のスイッチが 300ms 早く出る。**

分割前は `teardown()` が `loadMcpGroups()` を呼ぶ一方で、同じ `teardown()` が `dirInput` を
`defaultCwd` に戻すため dir 変更 watch が走り、`mcpGroupReq++` でその読み込みを**自分で無効化**して
いた。結果、スイッチは 300ms のデバウンス後にしか出なかった。分割後はフォームが新しくマウント
されて即座に読むので、その待ちが無い。400ms 進めた条件では両者一致するので、差は**遅延だけ**。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn typecheck:server` → `yarn typecheck:test` →
`yarn build` → `yarn test`。

`eslint.config.js` の `max-lines` 免除リストにある `TerminalCell.vue` の行数コメントを更新する
（**新しいファイルは免除に足さない** — 足した時点でガードレールが意味を失う）。
