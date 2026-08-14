# Windows CI を戻す — `survivorCandidates` の spec が正規化前のパスを渡していた

issue: #1539 / 原因を作った PR: #1534

## 何が起きていたか

`main` の **Windows (daily)** が #1534 のマージコミット `752961b5` から赤い（直前の `77e0769a` は緑）。

```text
FAIL test/server/session/dir-session.spec.ts > survivorCandidates
  > names a running survivor as a LIVE candidate of its own agent
      AssertionError: expected [] to deeply equal [ { id: 'key-1', live: true, … } ]
  > outranks a merely recent transcript once picked with
      TypeError: Cannot read properties of undefined (reading 'attached')   ← 1 件目の連鎖
```

Node 22.x / 24.x の両方。Windows は PR の required check に入っていない（`windows-daily.yaml` は
`push: [main]` + schedule + `workflow_dispatch`）ので、#1534 は緑のままマージされ、main への
push で初めて落ちた。

## 根本原因

`survivorCandidates(dir, logs, facts)` は **`dir` を正規化済みで受け取る契約**で、比較は片側だけを
正規化する:

```ts
// server/session/dir-session.ts
if (canonicalPath(record.cwd) !== dir) return [];
```

呼び出し元 `dirSession` は `canonicalPath(dir)` を渡しているので **プロダクションは正しい**。
spec だけが生の POSIX リテラルを `dir` に渡していた:

| | POSIX | Windows |
|---|---|---|
| `canonicalPath("/wt/fix-login")`（record 側） | `/wt/fix-login` | `D:\wt\fix-login` |
| spec が渡した `dir` | `"/wt/fix-login"` | `"/wt/fix-login"` |
| 一致するか | する | **しない** |

`canonicalPath` は存在しないパスでは `path.resolve` にフォールバックするので、POSIX では
リテラルと同値になり、たまたま通っていた。

## もう一つの害: Windows では 4 件が空振りで緑だった

`survivorCandidates` の spec 6 件のうち 4 件は「`[]` が返ること」を確かめる否定テストなので、
Windows では **何を渡しても `[]`** = 間違った理由で緑。落ちた 2 件はたまたま肯定テストだった。
つまり Windows 上ではこの spec 群が実質無効だった。

## 直し方

1. `test/server/session/dir-session.spec.ts` — `dir` 引数を `canonicalPath()` を通した定数
   （`WORKTREE` / `ELSEWHERE`）にする。**record の `cwd` は生の綴りのまま**にする: ログが実際に
   保持しているのはそちらで、非対称なままにしておくのが本番と同じ形。
2. 同 spec に「record の cwd が同じディレクトリを別の綴りで書いている場合も一致する」ケースを追加。
   両辺が同じリテラルの spec は「本当に比較している」のと「常に同じ答えを返す」のを区別できず、
   それが今回の失敗が隠れた理由そのものなので、正規化を経由することを固定する。
   `/wt/other/../fix-login` を使うので symlink を掘らずに済み、Windows でも同じ意味になる。
3. `test/server/routes/ws-session-admission.spec.ts` — #1534 のレビューで CodeRabbit が指摘した
   まま未対応だった **`settledEntry` の拒否ブランチ**（error frame + `early.discard()`）を 2 ケース
   追加。`closeWithError` は OPEN なソケットにしか送らないので、専用の `fakeOpenWs` を足す
   （既存の `fakeWs` で書くと「フレームを一切送らなくても緑」になる）。

## 同クラスの掃き出し

`canonicalPath` を使うプロダクション側は `codex-session.ts` / `config/worktree-env.ts` /
`git/worktrees.ts` / `session/dir-session.ts` / `session/worktree-session-limit.ts`。

- `codex-session.ts` の `sameDir` は **両辺**を正規化しているのでリテラル同士でも Windows で一致する
- 他は spec が実 tmpdir を使っている

→ 片側だけ正規化する非対称な契約を持つのは `survivorCandidates` だけだった。

## 計測のうえ「変更しない」と決めたもの

#1534 のレビューで挙げたコスト懸念は実データで計測した結果、誤差だった:

| 項目 | 実測 |
|---|---|
| grok survivor の `existsSync` 480 回（24 running key × 2 綴り × 10 worktree 相当） | 0.54 ms |
| conversation ログ再読み（実ファイル 1 KB / 4 行）× 10 | 0.036 ms |
| `tmux list-sessions` 同期 spawn | 7.0 ms / 回 |

効くのは同期 tmux spawn だけで、`/api/worktrees` と WS connect というユーザー操作起点のパスに
1 回ずつ。ここに短期キャッシュを入れると #1534 が直したばかりのオカレンシー鮮度を削るので、
入れない。

`GridView.onClose` がセッションを terminate するようになった件も #1534 の意図的な変更
（TerminalCell の × ボタンと揃える）なので変更しない。

## 検証

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
- **Windows は `workflow_dispatch` でこのブランチに対して実際に回す**。ローカル macOS で緑なのは
  今回の不具合について何も言わない（元の spec も macOS では緑だった）ので、外部の ground truth に
  当てる。

## この issue の対象外

#1536 / #1537（#1534 の作者が直後に立てた follow-up。再起動後のエンドポイント検証と codex の
activity 再アーム）は別途。
