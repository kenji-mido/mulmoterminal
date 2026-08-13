# feat(#1171): worktree の起点を issue に固定する

#1026 の段階1。worktree を作った時点で「どの issue の作業か」が確定するようにし、
下流（work item チップ・作業コメント・マージ時の自動クローズ）が推測をやめられるようにする。

## いま噛み合っていないもの

- UI が作るブランチは `agent/<slug>` で**番号を持たない**（`server/git/worktrees.ts`）
- 番号を復元する側は `^[a-z][a-z-]*\/([1-9]\d*)-` を期待している（`common/prPhase.ts`）
- 実際に効くのは PR 本文の `Fixes #N` だけだが、PR は `gh pr create --fill` で作られるので
  本文はコミット文そのまま＝`Fixes` は入らない

## やること

### 1. `issue/<N>-<slug>` でブランチを作る

`createWorktree(repoDir, task, issue?)`。番号ありなら `issue/<N>-<slug>`、なしなら従来どおり `agent/<slug>`。

`issue/` prefix は **このアプリが issue 起点で作ったブランチにしか付かない**。だから
`issueCandidateFromBranch`（`release/2026-07-28-hotfix` から 2026 を拾ってしまう「候補」）とは別に、
**推測ではない読み取り** `issueFromAnchoredBranch` を用意する。prefix は `common/` に置き、
作る側（server）と読む側が同じ定数を見るようにする。

### 2. worktree ディレクトリ名の prefix 決め打ちを外す

現在 `branch.replace(/^agent\//, "")`。このままブランチ名を変えると
`path.join(root, "issue/1026-x")` になり **1段ネストしたディレクトリが黙ってできる**
（`git worktree add` も `isManagedWorktree` も通るので、エラーは出ない）。

`worktreeDirName(branch)` として切り出し、**必ず1セグメントになる**ことをテストで固定する。
`agent/<slug>` に対する出力は従来と同じ。

### 3. issue 起点のときだけ base を `origin/<default>` にし、作成前に fetch する

`git worktree add -b <branch> <dir> main` は**ローカル main から分岐**している。
実測: この repo の作業クローンは `git fetch` 前 `HEAD..origin/main = 0`、fetch 後 **20**。
fetch していないクローンの「遅れていない」は根拠にならない。

- 作成前に `git fetch origin`（best-effort、失敗しても作成は続ける。オフラインで使えなくならないこと）
- fork 元は `origin/<base>`。ただし**ローカル `<base>` が既に `origin/<base>` を含んでいる場合はローカル**
  （上位集合なので何も失われず、push していないローカルコミットを落とさない）。behind / diverged のときだけ
  リモートを取る。`origin/<base>` が無ければ従来どおりローカル
- **適用は issue 起点の作成だけ**（ユーザー決定）。手でタスク名を入れる既存の導線は
  ローカル base のまま・fetch なしで、体感を変えない。この非対称はテストで固定する
- **`defaultBaseBranch` の戻り値は変えない。** あれは PR の `--base` と compare URL に使う
  「ベースブランチ名」であり、`origin/main` を渡すと PR が壊れる。fork 元は別の関数にする
- fetch はネットワーク待ちなので `git()` に短めのタイムアウトを渡せるようにする
  （既定の 120s のまま待たせると、作成ボタンが固まったように見える）

### 4. PR 本文に `Fixes #N`

`createOrOpenPR` が、**作ったばかりの PR に限り**（既存 PR の本文は書き換えない）本文へ挿入する。
番号は `issueFromAnchoredBranch(branch)` から。`issueRefFromPrBody` が既に closing keyword を
読めるので、本文が既に何か宣言していれば足さない。

footer（`work in <clone>`）が最後に来る必要があるので、**1回の read → 2つの変換 → 1回の write**
にまとめる。

## テスト

- `issue/<N>-<slug>` の生成 → `issueFromAnchoredBranch` で往復
- `issueFromAnchoredBranch` が `agent/...` / `release/2026-...` / `fix/1152-...` を拾わないこと
  （拾ってよいのは、このアプリが付けた prefix だけ）
- `worktreeDirName` がネストを作らないこと
- fork 元の解決: `origin/<base>` があればそれ、無ければローカル
- `withIssueRef` の冪等性（既に `Fixes #N` / `Closes #N` があれば足さない）

## やらないこと

- (repo, branch) → issue の**永続化**。命名で解決できるぶんは命名でやり、記録は手作りブランチや
  rename のフォールバックが実際に要ると分かった時点で足す（#1026 のコメント参照）
- マージ / issue クローズ / 片付けの導線（#1026 段階3）
