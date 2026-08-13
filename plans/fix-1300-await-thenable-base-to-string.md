# fix(lint): `await-thenable` と `no-base-to-string` を error で導入（#1300 の一部）

#1300 に残っていた型情報必須ルールのうち、**件数が小さく、かつ意味のある値の壊れ方を
捕まえる 2 つ**を片付けて error に上げる。`no-unsafe-*`（303 件）は #1300 に残す。

| ルール | 件数 | 対応 |
|---|---|---|
| `@typescript-eslint/await-thenable` | 2 | 全部直して **error** |
| `@typescript-eslint/no-base-to-string` | 17 | 全部直して **error** |

## `await-thenable` の 2 件 — 片方は実際に読み手を騙していた

- `server/backends/wiki.ts` — `res.json(await readWikiIndex(workspace))`。
  `readWikiIndex` は `@mulmoclaude/core` の**同期関数**（`engine.d.ts` の宣言は
  `(workspace: string) => {...}` で Promise ではない）。`await` は何も待っておらず、
  「ここは I/O だから遅い」という**嘘の合図**を出しているだけだった。外した。
- `server/routes/session-routes.ts` — `Promise.all` に渡す配列の片方の枝が素のオブジェクト。
  `Promise.all` は非 thenable をそのまま通すので**動作は正しい**が、2 つの枝が別の型に
  見える。`Promise.resolve(...)` で包んで枝を揃えた。

## `no-base-to-string` の 17 件 — `String()` は必ず答えるので、壊れた値が旅に出る

全部 `String(x ?? "")` の形で、`x` の型が `unknown` / `string | undefined` より広い箇所。
**オブジェクトが来ると `"[object Object]"` という文字列になる。** 例外は出ないので、
それが collection の slug としてルックアップに使われ、セッションのタイトルとして画面に出る。
「値が無い」と「値が壊れている」が区別できなくなるのが本当の問題。

新設した `common/readString.ts` に寄せた（`common/` なのは、同じ判断を将来 UI 側でも
使うため）:

- `readString(unknown): string` — 文字列ならそれ、でなければ `""`。
  呼び出し元はもともと `String(x ?? "")` で書かれていたので、**「無い場合は空文字」という
  既存の挙動はそのまま**。変わるのは「オブジェクトが来たとき」だけ。
- `describeValue(unknown): string` — **人間向けのエラーメッセージ**用。ここは入力が壊れて
  いること自体が主題なので、形を残す必要がある。`JSON.stringify` を使い、循環参照は
  `"[unserializable]"` に落とす。

置換した 17 箇所:

| ファイル | 件数 | 使ったもの |
|---|---|---|
| `server/backends/remoteHost/handlers/*.ts`（5 ファイル） | 8 | `readString` |
| `server/session/transcript.ts` | 3 | `readString` |
| `server/session/session-reads.ts` | 2 | `readString` |
| `server/git/prs.ts` | 2 | `readString` |
| `server/backends/wiki.ts` | 1 | `describeValue` |
| `server/config/workspace.ts` | 1 | `describeValue` |

`remoteHost/handlers/*` の 8 件はスマホから来る command の `params` を読む所なので、
**外から非文字列が入り得る唯一のグループ**。ここが `"[object Object]"` を slug として
引くのが一番現実味があった（実害の報告は無い）。

## 残課題

`no-unsafe-argument` / `-assignment` / `-call` / `-member-access` / `-return` の 303 件は
#1300 に残す。件数の内訳と、`.vue` へ型情報を通す件も同 issue に記録済み。
