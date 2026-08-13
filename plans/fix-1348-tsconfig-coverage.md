# fix(tsconfig): どの project にも属さないファイルを無くす (#1348)

## ① 未被覆 3 ファイル — 実測して再現

5 つの project すべてで `--listFiles` を取り、その和集合を追跡ファイルと突き合わせた。

```console
$ for p in app node server test test-server; do npx vue-tsc -p "tsconfig.$p.json" --listFiles --noEmit > /tmp/$p.txt; done
$ comm -23 <tracked> <covered>
scripts/model-trials.ts
test/helpers/appRequest.spec.ts
vitest.config.ts
```

issue の報告どおり 3 件。**`yarn typecheck` / `build` / CI のどれもこの 3 つを見ていない。**

`.vue` を含む project は `vue-tsc` で取る必要がある（plain `tsc` は `.vue` を展開しないので大量の誤検出になる）。

### 直し方

| project | include | 理由 |
| --- | --- | --- |
| `tsconfig.node.json` | `["vite.config.ts"]` → `["*.config.ts", "scripts/**/*.ts"]` | 1 ファイル名を直書きしていたのが主因。パターンにすれば次に増える root config / script は書いた日から被覆される |
| `tsconfig.test-server.json` | `test/helpers/**/*.ts` を追加、`test/helpers/xtermDouble.ts` を exclude | `appRequest.spec.ts` がどこにも属していなかった |

`test/helpers/` は両サイドの helper が同居している。`xtermDouble.ts` は `HTMLElement` / `document` を
参照するため `types: ["node"]` の project では通らない。**ディレクトリごと include して 1 ファイルだけ
exclude する**形にしたのは、ファイル名の列挙こそが今回 spec を取りこぼした原因だから。`xtermDouble.ts`
自体は `test/src` の spec 経由で `tsconfig.test.json` が DOM lib 付きで見ている（被覆は確認済み）。

### 被覆したら見つかったもの

`test/helpers/appRequest.spec.ts` に **TS6133 が 4 件**（未使用の `req`）。検査されていなかったから
残っていたわけで、issue の主張がそのまま実証された形。`_req` に直した。

### 検証は「clean」ではなく「検出される」で行う

追跡 1173 ファイルすべてが被覆されたことに加え、**3 ファイルそれぞれに型エラーを仕込んで検出される
ことを確認した**。緑であることは検査されている証拠にならない（#1313 と同じ理由）。

## ② `noImplicitReturns` — 入れないと決めた

issue は「mulmoclaude では 0 件で導入できた」としていたが、**このリポジトリでは成立しない**。

| project | 件数 |
| --- | --- |
| app | 0 |
| node | 0 |
| server | **31** |
| test-server | **27**（server のファイルを再検査した分） |

合計は #1301 が記録した 58 件と一致する。実体は **33 個の Express ハンドラ**で、すべて

```ts
if (bad) return res.status(400).json({ error: "…" });
```

という形。TS7030 が鳴るのは「片方の経路が `res` を返し、フォールスルーが何も返さない」ためで、
これは Express ハンドラの正しい書き方そのもの。**欠陥の指摘ではなくハウススタイルの指摘**であり、
33 個のルートハンドラを書き換えても安全性は増えない。

よって **app / node のみ on**、server 系は off で確定。`tsconfig.server.json` に「意図的に無い」ことと
実測値を書き、`tsconfig.app.json` からそこを指した — 片方だけ見て「揃っていない」と足されるのを防ぐため。

### 測定時に踏んだ罠（記録）

最初 `grep -cE "error TS7030"` で数えて **全 project 0 件**という誤った結果を得た。`vue-tsc` の出力は
`error` と `TS7030` の間に ANSI カラーコードが入るので、この正規表現は永久に一致しない。
**色を落としてから grep する**（`sed 's/\x1b\[[0-9;]*m//g'`）。同じ間違いで
`tsconfig.test-server.json` の検証も一度すり抜けた。

## 補足

`<template>` 内の `as`（`SettingsField.vue`）は #1341 で解消済みで、現在 0 件。issue の記述どおり。
