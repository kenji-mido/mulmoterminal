# fix(#1219): 同じ issue を2回始めたら、2本目を切らずに既にあるものを開く

## いま起きていること

「これをやる」をもう一度押すと `issue/<N>-<slug>-2` が黙って作られる。同じ issue の作業ツリーが
2本になり、`Fixes #N` を持つ PR も2本出せてしまう。#1171 でブランチに番号を入れたのは
「issue と branch の対応を推測ではなく記録にする」ためなので、記録が2つを指している状態になっている。

`-2` を付けているのは `uniqueBranch`（`server/git/worktrees.ts`）だが、**その連番は別の問題のために
書かれたもの** — `agent/<N>-x` と `issue/<N>-x` が同じディレクトリ名を取り合う衝突の回避で、
ランチャーの自由記述タスク名（同じ名前を2回打つのは普通）では今も正しい挙動。
**`issue` を渡された経路だけ**が直す対象。

## 答えは #1207 が既に持っている

「その worktree にはもうセッションがある」への答えは #1207 が出している。語彙も判定もあるので、
2つ目の答えを作らずそこに乗せる。

- `worktreeAction(session)` → `start` / `resume` / `busy`（`common/worktreeSession.ts`）
- `worktreeOccupancy(cwd)` → 管理下の worktree か ＋ そこにいるセッション（`server/session/worktree-session-limit.ts`）
- `worktreeLimitReason(session)` → 断るときの文（読む人の次の動作を書いてある）

「このブランチはどの issue のものか」も既に唯一の読み手がいる — `issueFromAnchoredBranch`
（`common/prPhase.ts`）。PR 本文の `Fixes #N` と work chip が使っているものと同じ。
**2本目の正規表現を書かない。** `-2` が付いていても番号は変わらないので、そのまま効く。

## 変える挙動

`startIssueWork(repo, issue, dir)` は、worktree を切る前に **その issue の管理下 worktree を探す**。

| 見つかったもの | すること | `outcome` |
| --- | --- | --- |
| 無い | 今までどおり切って spawn | `created` |
| ある・セッション無し | **切らずに** その中で spawn（issue 本文は入力欄へ） | `reused` |
| ある・セッションはいるが誰も掴んでいない | **spawn しない**。既存セッションの id を返す（セルはそれに繋ぐ） | `resumed` |
| ある・誰かが掴んでいる | **何もしない**。`worktreeLimitReason` の文で断る | — (`worktree-busy`) |

`resumed` のとき issue 本文は入力欄に入らない（そのセッションには既に履歴がある）。
デスクトップ側は `placeSpawnedChat` の `draft` をそれに合わせる。

## 変更するファイル

1. `server/git/worktrees.ts` — `issueWorktree(repoDir, issue)`（`listWorktrees` ＋ `issueFromAnchoredBranch`）
2. `server/git/issue-work.ts` — 上の表。`occupancyOf` / `findWorktree` は差し替え可能な dep にする
3. `server/routes/issue-work-routes.ts` — `worktree-busy` は 409（呼び手が対処できる失敗）
4. `server/backends/remoteHost/handlers/issueWork.ts` — 断りの文はそのまま throw（既存経路）／`outcome` を返す
5. `src/composables/useIssueStart.ts` — `draft: outcome !== "resumed"`
6. `docs/remote-host-protocol.md`、`docs/guide/{en,ja}/github.md`

## テストで固定すること

- 既存 worktree があるとき **`makeWorktree` が呼ばれない**（これが issue そのもの）
- セッション無し → 既存ツリーで spawn、`reused`
- セッションが idle → **spawn せず**既存 id を返す、`resumed`
- セッションが attached → spawn も作成もせず断る、文に次の動作が書いてある
- 無ければ今までどおり `created`（回帰）
- `issueWorktree` は `-2` 付きも拾い、別 issue のブランチは拾わない
- ルートは `worktree-busy` を 409 で返す

## やらないこと

- **別クローンに切られた同じ issue の worktree を探すこと** — `listWorktrees` はそのリポの worktree
  しか見ない。クローンを跨いだ重複は「どのクローンで作業するか」の話（#1172 の記録）で、別問題。
- **`agent/<slug>` の連番をやめること** — あちらでは正しい。
