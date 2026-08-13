# fix-1362: `sonarjs/void-use` を off にした理由は事実ではなかった

refs #1362, #1300, #1308

## 何が間違っていたか

`eslint.config.js` の型情報つきブロックに、こう書いてあった。

```js
// `void` is what no-floating-promises asks for to mark a deliberate fire-and-forget. The two
// rules contradict each other; we chose the one that catches a forgotten `await`.
"sonarjs/void-use": "off",
```

**2つのルールは矛盾していない。** `sonarjs/void-use` (S3735) は promise を最初に除外する。

## 実測（この PR の作業ツリーで確認）

### ① ルール実装 — `node_modules/eslint-plugin-sonarjs/cjs/S3735/rule.js` (v4.2.0)

```js
'UnaryExpression[operator="void"]': (node) => {
  if (isVoid0(unaryExpression) || isIIFE(unaryExpression) || isPromiseLike(context, unaryExpression)) {
    return;   // 報告しない
  }
```

`isPromiseLike` は **型情報があるとき** `isThenableOrVoidUnion` / 短絡式の `isThenableOrGuardUnion` /
呼び出し式の `any`・`unknown`（`hasIndeterminateType`）で早期 return する。
**型情報が無いときは「呼び出し式なら promise かもしれない」として一律 return する**
（`isCallLikeExpression`）。つまり型情報の有無にかかわらず `void <promise 呼び出し>` は素通りする。

### ② リポジトリ全体で有効化して実測

```
npx eslint . --rule '{"sonarjs/void-use":"error"}'
```

```
server/session/tmux-size-sync.ts:74:35
server/session/tmux-size-sync.ts:92:81
server/session/tmux-size-sync.ts:93:34
→ 3 errors
```

**報告されたのは 3 件だけ**で、fire-and-forget は 1 件も報告されない。3 件を直したあと、
`server/`・`src/`・`common/` に残る `void` 演算子は **163 箇所**（`.ts` 88 + `.vue` の script 75、
spec を除く。#1308 の 66 件を含む）で、そのどれも報告されない。
TypeScript の AST で `VoidExpression` を数えた実測値（`void 0` は除外）。

数え方で 2 度つまずいたので記録しておく。

> **grep で数えると間違える。** `[ (,;{}=&|?:[]void ` のような文字クラスは `): void` の戻り値注釈にも
> マッチするので、最初の見積り（約 200）は水増しだった。数えるなら AST。
>
> **この数は main をマージするたびに動く。** 161 → 163 と実際に動いた。だから
> `eslint.config.js` のコメントには具体的な数を焼き込まず「160-odd」と書いてある
> —— 腐ってからでは、直そうとしている嘘と見分けがつかない。

> 注: 実測の前に `yarn install` が要る。pull 直後の stale な `node_modules` だと
> `src/composables/pluginRuntime.ts` に `no-unsafe-*` が 4 件出て、ベースラインが赤に見える。

### ③ 残る 3 件は promise ではない

`Map.delete()` / `Map.set()` の戻り値を捨てるための `void`。アロー関数の式本体を `: void` の
シグネチャに合わせるイディオムで、fire-and-forget とは無関係。

## 直しかた

1. `server/session/tmux-size-sync.ts` の 3 箇所をブロック本体にする。
   `(id) => void holder.delete(id)` → `(id) => { holder.delete(id); }`。挙動は変わらない
   （どちらも戻り値を捨てる）。
2. `eslint.config.js` の `sonarjs/void-use` を OFF 群から ERROR 群へ移し、
   **コメントを事実に書き直す**（矛盾ではなく「promise は除外される／捕まえるのは
   promise でない値への `void`」）。
3. 嘘が残っている公開物を直す。
   - `docs/ChangeLog.md` の 4.2.0 エントリ — 公開サイトに出ている。履歴は消さず、
     訂正であることが分かる形で直す。
   - `plans/fix-1300-sonarjs-decisions.md` — off の判断そのものの記録。訂正リンクを足す。

`plans/feat-remote-host.md` と `plans/feat-shared-backend-services.md` にも
「lint は `void` 演算子を禁じる」とあるが、両方とも同じ文で `id-length` / `no-shadow` /
`import/no-duplicates` を挙げていて、**そのどれもこの設定に存在しない**。別リポの慣習を写した
古いスナップショットなので、1 行だけ直しても意味がない。触らない。

## 退行をどう防ぐか

- **「off に戻される」** → `test/scripts/eslint-void-use.spec.ts` が、解決後の設定で
  `sonarjs/void-use` が error であることを `calculateConfigForFile` で確かめる
  （型プログラムを作らないので速い）。`eslint-template-assertions.spec.ts` と同じ手口。
- **「promise の除外が将来のバージョンで消える」** → 161 箇所が一斉に赤くなるので
  `yarn lint` が CI で落ちる。リポジトリのソースそのものが ground truth なので、
  これを spec で写し取る必要はない（写せば型プログラムを 1 本余計に建てるだけになる）。
