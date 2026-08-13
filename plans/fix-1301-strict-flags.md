# fix(tsconfig): 厳格化フラグ + 型情報を要する promise ルール (#1301 / #1300 の一部)

## 実測: issue の「全部 0 件で入る」は成立しなかった

#1301 は 5 つのフラグすべてが 0 件だと書いている。**server と app を個別に
`tsc -p ... --flag` で測ると確かに 0 だが、CI が実際に走らせる形（設定ファイルに
書いて `yarn typecheck` / `typecheck:server` / `typecheck:test`）で測ると違う。**

| フラグ | app | server | test | 判定 |
|---|---|---|---|---|
| `useUnknownInCatchVariables` | 0 | 0 | 0 | **入れた** |
| `noImplicitOverride` | 0 | 0 | 0 | **入れた** |
| `noImplicitReturns` | 0 | 31 | 27 | 見送り |
| `noUncheckedIndexedAccess` | 47 | 71 | 327 | 見送り |
| `noPropertyAccessFromIndexSignature` | 337 | 609 | 839 | 見送り |

なぜ個別計測が 0 になったのかは追い切れていないが、`tsBuildInfoFile` による増分
キャッシュか、`-p` と build mode の差である可能性が高い。**どちらにせよ、計測は
「CI が動かすコマンド」でやらないと意味がない**というのが教訓。

### 見送った 3 つについて

- `noImplicitReturns`（58 件）— ほぼ Express ハンドラの
  `if (bad) return res.status(400)...` と fall-through の混在。**Express の書き方として
  正しい**ものを機械的に書き換えることになるので、価値と churn が釣り合わない。
- `noUncheckedIndexedAccess`（445 件）— #1301 が「最優先」とする通り価値は高い
  （`arr[i]` が `T` ではなく `T | undefined` になる）。ただし 445 件は独立した作業。
- `noPropertyAccessFromIndexSignature`（1785 件）— `obj.key` を `obj["key"]` に
  書き換えるだけで、型の穴は塞がらない。優先度は最も低い。

## 型情報を要する lint（#1300 のうち promise 2 つ）

`no-floating-promises` / `no-misused-promises` を **warn** で導入した。
`no-unsafe-*` 系（139 件）は #1300 に残す。

### 途中で踏んだもの

1. **`projectService: true` では server が拾えない。** root の `tsconfig.json` は
   app と node しか参照していないので、`server/**` が「プロジェクトに無い」と 321 件の
   パースエラーになった。`project: ["./tsconfig.app.json", "./tsconfig.server.json"]` と
   明示するのが正解。
2. **`.vue` に `tseslint.parser` を直接指すと SFC がパースできない。** `.ts` のみに
   絞った。Vue ブロックへ型情報を通すのは別の作業。
3. **spec は除外が必要。** どちらのプロジェクトにも含まれないため。
4. **型情報が入った瞬間、既に error 設定なのに動いていなかった sonarjs ルールが
   8 種 30 件起動した。** これまで一度も強制されていなかったので、**warn にして
   #1300 で読む**ことにした（取り上げてはいない）。

### floating-promises 34 件を読んだ結果

サンプルした範囲では**実バグは見つかっていない**。

- `tool-store.ts` の 4 件 — `save` は宣言に「best-effort, fire-and-forget」と書かれ、
  内部で try/catch している。**await しないのが設計**。
- `router.push(...)` 系 — Vue Router の戻り値を待たないのは通常。
- `onMounted(() => load())` — 意図的な fire-and-forget。

つまりこのルールの価値は、いまのところ「意図を明示させること」にある。34 件を
`void` で明示するかは #1300 で判断する。
