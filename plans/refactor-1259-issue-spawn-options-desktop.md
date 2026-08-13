# refactor(#1259): デスクトップの issue 起動も issueSpawnOptions を通す

## いま二重になっているもの

#1253 で「種を draft として置くか、送信まで行うか」の決定を純関数 `issueSpawnOptions` に出した。
スマホ経路はそこを通るが、デスクトップ経路 `server/routes/issue-work-routes.ts` はオプションを
直書きしたままで、`attachGuiMcp: false` の**理由コメントごと**重複している。

出力は同じ。危ないのは出力ではなく、**同じ判断が2箇所にあること**。

## この重複が壊れるときの壊れ方

`planDraftInjection` は `draft ?? initialPrompt` を解決する。つまり:

- 両方立てば **draft が勝つ** — auto-run は静かに効かなくなる
- どちらも立たなければ **何もタイプされない**

いずれも例外を投げず、ログにも出ない。`typecheck` もテストも CI も通る。
だからこの決定は 1 箇所に閉じ、テストで固定する価値がある。

## テストの穴（この refactor で塞ぐ）

`test/server/routes/issue-work-route.spec.ts` は `startIssueWork` の引数は検証しているが、
**`spawnClaudePty` に渡ったオプションを一度も assert していない**。
「デスクトップは draft のまま」という #1253 の決定が、今は何にも守られていない。

refactor の前後で挙動が変わらないことを保証するのは、まさにこの assert なので、
コードを差し替える前に**先にテストを足す**。

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `server/routes/issue-work-routes.ts` | `issueSpawnOptions(cwd, draft, false)` を使う。`IssueWorkRouteDeps.spawnClaudePty` の `options` 型を `SpawnClaudeOptions` に広げる |
| `test/server/routes/issue-work-route.spec.ts` | スタブの型を合わせ、デスクトップの spawn が `draft` を持ち `initialPrompt` を持たないことを固定 |

`options` 型を広げる件: 現在の narrow な型に付いている「わざと狭くしている」という注記は、
**返り値を `PtyEntry` にしないため**の話（テストを含む全呼び出し元に `PtyEntry` を作らせない）。
オプション側が狭いのは付随的なもので、実際の配線 `app-routes.ts` は
`ReturnType<typeof createClaudeSpawner>["spawnClaudePty"]`（= `SpawnClaudeOptions` を取る）を渡している。
広げても呼び出し元は影響を受けない。注記は返り値の話であることが分かるよう書き直す。

## テストで固定すること

- デスクトップの spawn オプションが `{ cwd, draft, attachGuiMcp: false }` であること
- **`initialPrompt` を持たないこと**（持つと draft が勝って auto-run しない、という静かな壊れ方の入口）
- `cwd` が worktree であって、切り出し元のクローンではないこと

## やらないこと

- 挙動の変更。デスクトップは今までどおり「入力欄に入れて送信しない」
- スマホ経路 (`server/index.ts` / `handlers/issueWork.ts`) の変更
- `randomUUID` によるセッション ID 生成の共通化 — スマホ側は `markUnplacedSession` も呼ぶので
  同じ関数にはならない。共通なのは**オプションの決定**だけで、そこはもう共通化されている
