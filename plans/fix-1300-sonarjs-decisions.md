# fix(lint): 型情報つき sonarjs 8 種を1件ずつ判断する (#1300 の残り)

型プログラムが入って初めて動き出し、`warn` で放置していた sonarjs ルール群。**18 件を1件ずつ
読んで**、ルールごとに error / warn / off を決めた。

| | before | after |
|---|---|---|
| sonarjs の warning | 18 | **5** |
| lint warning 合計 | 23 | **10** |

## 直したもの（3件）

### `different-types-comparison` — 死にコードだった（1件）

`terminalFilePathLinks.ts` の `if (start === undefined) continue;`。**`matchAll` は global 正規表現を
要求し、返すマッチには仕様上つねに `index` が入る**ので型も `number`。ガードは常に偽だった。

前回この規則が挙げた 9 件は `noUncheckedIndexedAccess` 欠落による偽陽性だったが、**それは
#1310 で解消済み**で、今回のこれは本物。削除して **error** に上げた。

消したガードが何を守っていたつもりだったのかを固定するテストを 2 件追加（index 0 から始まる
パス、1行に複数マッチして range が本文に戻ること）。この関数の spec は元々あった。

### `deprecation` — Node の型エイリアス（2件）

`NodeJS.UnhandledRejectionListener` / `UncaughtExceptionListener` は `@types/node` が deprecate
済みで、**doc が代替を名指し**している（`ProcessEventMap['unhandledRejection']`）。そのとおりに
書き換えた。

## error に上げたもの

| ルール | 理由 |
|---|---|
| `different-types-comparison` | 0 件。型上つねに偽の比較は本物のバグの匂い |
| `no-alphabetical-sort` | 0 件。`sort()` の既定は文字列比較で、数値配列では壊れる |
| `no-misleading-array-reverse` | 0 件。`reverse()` は破壊的 |
| `no-useless-intersection` | `.ts` では 0 件（`.vue` は下記で off） |

## off にしたもの — **偽陽性の理由が構造的**で、放っておくと出続ける

### `function-return-type`（3件）

3 件とも **union の戻り値型を宣言している**関数だった。

| 箇所 | 宣言 |
|---|---|
| `probeEvidenceIn` | `"tool" \| { said: string } \| null` |
| `fromParsed` | `JsonValue`（それ自体が union） |
| `sanitizeChip` | `HeaderChip \| null` |

union が契約そのもの。潰すには全部を箱に入れることになり、ルールを満たすためだけに型が悪くなる。

### `reduce-initial-value`（2件）

どちらも**空になり得ない**。

- `codex-rate-limits.ts` — 直前の行が `if (near.length === 0) return null;`
- `screen-rows.ts` — `[head, ...rest]` を畳んでいるので必ず 1 要素以上

ルールはどちらも見えない。初期値を足すと**死にコードであるうえに戻り値の型まで変わる**。

### `no-selector-parameter`（1件）

`settingsArgument(sessionId, json, secret, platform)`。唯一の本番呼び出しが
`Object.keys(resolved.env).length > 0` と**計算した値**を渡している。関数を 2 つに割っても、
同じ分岐が呼び出し側に移るだけ。

### `no-useless-intersection` — `.vue` のみ off（4件）

**Vue の `defineEmits<>` は呼び出しシグネチャだけを持つ interface を交差させて emit 型を合成する**
（`GridCellEmits & { (e: "session", id: string): void }`）。ルールはそれを「メンバーの無い型」と
読む。外せば子の emit が消える。4 件すべて `.vue` で、`.ts` では 0 件だったので **`.vue` だけ off、
他は error**。

### `void-use`（変更なし・off のまま）

`no-floating-promises` が求める `void` を禁じる。両立しないので、await 忘れを捕まえる方を採る。

> **訂正 (#1362)**: この判断は誤り。S3735 は thenable・`void 0`・IIFE・型が付かない呼び出しを
> 先に除外する（型情報が無い場合は呼び出し式を一律除外する）ので、`no-floating-promises` とは
> 矛盾しない。ここで数えた 3 件は promise ではなく `void map.delete(…)` だった。
> 3 件を直して **error** に変更済み。→ `plans/fix-1362-void-use.md`

## warn のまま残したもの — `deprecation`（5件）

**意図的に使っている外部 API なので 0 にはならない**が、**新しい deprecation が出たときは見たい**。
残る 5 件と、それぞれ残す理由:

| 箇所 | 理由 |
|---|---|
| MCP SDK の `Server`（3件） | SDK 自身の注記が「**低レベル API を使う advanced use case では `Server` を使え**」と言っている。私たちは `setRequestHandler` を使う低レベル利用 |
| `document.execCommand("copy")` | 既存の選択範囲に対して**同期で**効くコピー。非同期の Clipboard API では置き換えられない |
| `e.returnValue` | legacy Chrome/Edge が beforeunload のプロンプトを出すのに今も要求する（コード側にも元からコメントあり） |
