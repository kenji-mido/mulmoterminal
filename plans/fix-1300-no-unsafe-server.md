# fix(server): `no-unsafe-*` を server 側だけ 0 にする (#1300 の一部)

## 範囲

`no-unsafe-*` 5 ルールの **407 件のうち、server/ の 145 件**を全部消す。`src/` の 262 件は
この PR では触らない（同じ手が使えるので続きは別 PR）。

| | before | after |
|---|---|---|
| server/ | **145** | **0** |
| 全体 | 407 | 262 |

## `any` の入口は 3 つしか無かった

145 件は散らばって見えるが、出どころは 3 種類だけだった。

### 1. `await import(name)` — `server/infra/plugins-registry.ts`（64 件、単一ファイル最大）

動的 import の戻り値は `any`。そこから `mod.default` / `mod.TOOL_DEFINITION` /
`mod.pluginCore?.execute` と辿るので、**プラグインの定義も実行関数も型検査の外**にいた。

`isRecord` で受けてから、`isToolDefinition`（`type` / `name` / `description` の必須3フィールド）
と `isExecutor` で確認する形にした。`isExecutor` は `server-tool-load.ts` に既にあったものを
export して再利用（`typeof x === "function"` は `Function` にしか絞れず、`Function` の呼び出しは
`any` を返すので、これが無いと結果がまた型検査の外に出る）。

### 2. `JSON.parse(...)` — 7 ファイル

`plugins.json` / activity-state / scheduled-sessions / cleared-transcripts / tool-store /
app config / PTY のクライアントフレーム。全部 `: unknown` で受けてからガード。

PTY のフレームは 2 箇所で同じことをしていたので `parseClientFrame` に集約した
（**ここは PTY に書き込む値なので、境界を 1 つにする価値が特に高い**）。

### 3. `req.body` — 8 ファイル

express の `req.body` は `any`。`server/routes/requestBody.ts` に

```ts
export const requestBody = (body: unknown): Record<string, unknown> => (isRecord(body) ? body : {});
```

を置いて全箇所を通した。ハンドラ側は元から
`typeof req.body?.x === "string" ? ... : default` と書かれていたので、**ガードはそのまま。
違うのは、そのガードが型検査の対象になったこと**。

## 型が通って初めて消せたもの

`server/git/worktree-routes.ts` に、この `any` を回避するためのコメント付き再チェックがあった。

```ts
// Re-checked rather than reusing the guard above: `req.body` is `any`, and narrowing it there
// does not survive to here — the call would take `any` and typecheck would not notice.
const wt = await createWorktree(repoDir, task, isIssueNumber(issue) ? issue : undefined);
```

`requestBody` を通すと上のガードがちゃんと効くので、**再チェックごと削除**した。

## 型が嘘をついていた箇所（実際の穴）

### `translation-worker.ts` — `Promise<string[]>` が検証していなかった

`pendingTranslations` の `resolve` が `(translations: string[]) => void` と宣言されていたが、
中身は**ワーカーが submitTranslation に渡した何か**で、誰も検証していなかった。
`submitTranslation` 側が `Array.isArray(x) ? x : []` としており、`x` が `any` なので
`any[]` → `string[]` に黙って化けていた。

- 待っている側（`runTranslationWorkerOnce`）は**既にこれを信用しておらず** `const translations:
  unknown = await submitted;` と受け直して `isValidTranslationResult` で検証していた。
- なので `resolve` の型を `unknown` にした。検証は 1 箇所（`isValidTranslationResult`）のまま。

**副作用としてエラーメッセージが正確になった。** 非配列を渡したとき、以前は `[]` に潰してから
検証していたので「`0 strings for 1 inputs`」= 件数不一致として報告されていた。実際には型が
違うので、いまは「`a non-array for 1 inputs`」と出る。**この古い挙動を固定していたテストが
あったので、正しい方に更新した**（テスト名も含めて）。

配列を `filter` で string だけにする案は取らなかった。**この配列は位置対応**で、長さが
`expected` と一致することが検証条件だから、落とすと意味が変わる。

### `tool-store.ts` — 自分が書いたファイルを読み戻して `T[]` と名乗っていた

`createSessionStore<T>` が `Array.isArray(parsed) ? parsed : []` で `any[]` を `T[]` にしていた。
手で編集されたり、クラッシュで切れたり、古いバージョンが書いた JSON でも、**型引数だけを根拠に
T[] になる**。

`isEntry: (value: unknown) => value is T` を**必須**引数にした（optional にすると既定が
「全部通す」になり元に戻る）。呼び出し 2 箇所には `isToolResult` / `isToolCall` を書いた
（必須フィールドと、存在する場合の optional フィールドを両方見る）。spec 10 箇所も更新。

こちらは**位置対応でない**ので、壊れた要素だけ落とす。

## `Array.isArray` の罠

`Array.isArray(value)` は `unknown` を **`any[]`** に絞る（`unknown[]` ではない）。つまり
`Array.isArray(x) ? x : []` は要素が `any` の配列を返し、そこから先が全部型検査の外に出る。
今日 `transcript.ts` でも踏んだ形なので、`common/isUnknownArray.ts` に guard を置いた。

## 検証

**「lint が 0 になった」は「壊していない」の証拠にならない**ので、プラグインレジストリは
実際にロードして突き合わせた。

```
X_BEARER_TOKEN=dummy npx tsx <probe>   # main と本ブランチの両方で
```

ツール名 13 個・`toolSummaries` 13 件・`parameters` を持つ定義 13/13 が **完全一致**。
factory 形式（google）と server-tool 形式（readXPost / searchX）の両経路を含む。

`yarn typecheck` 0 / `yarn lint` 0 errors（warning 23 は main と同数）/ `yarn build` /
`yarn test` 7585 passed。

## この PR で直していないもの

`src/` の 262 件。入口は同じ（`JSON.parse`、`await import`、socket のメッセージ）なので
同じ手が使える。#1300 に残す。
