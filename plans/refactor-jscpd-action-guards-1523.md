# refactor: code scanning の duplicate-code アラート 2 件を解消する (#1523)

`duplication-scan` (jscpd 5.0.12, minTokens=50 / minLines=5) の open アラートは 2 件。
SARIF は**片側の位置しか持たない**ので、対を知るには CI と同じ引数でローカル実行する
（`plans/refactor-jscpd-duplicates-1472.md` と同じ手順）:

```
npx jscpd@5.0.12 . --format "typescript,vue" \
  --ignore "**/node_modules/**,**/dist/**,**/*.d.ts,**/*.spec.ts" --reporters console
```

| alert | 片側 | 対 | tokens |
| --- | --- | --- | --- |
| 150 | `server/backends/collections.ts` 556-562 | `server/backends/customViewRoutes.ts` 137-143 | 79 |
| 151 | `server/backends/collections.ts` 773-778 | `server/backends/customViewRoutes.ts` 150-155 | 57 |

## 何が重なっているか

record-level action を押すルートは 2 本ある。宛先が同じで、通し方だけが違う:

- 親側 `POST /:slug/items/:itemId/actions/:actionId` — `itemActionHandler`（collections.ts）。
  seed 系（chat / agent）も mutate も通す。
- view token 側 `POST /:slug/view-data/actions/:actionId` — `makeActionHandler`
  （customViewRoutes.ts）。mutate だけを通す。

同じ宛先なので前置きのガードが同型になり、それが写しのまま 2 本ある:

1. **action の 404** — `schema.actions` から id で引き、無ければ同じ文言で 404（alert 150）
2. **read-only collection の 405** — `collectionWritable` → `readOnlyRefusal`（alert 151。
   collections.ts 側は `itemActionHandler` と `viewDataPutHandler` の 2 箇所にある）
3. **record の 404 と `actionVisible` の 409** — jscpd は拾っていないが、
   `itemId` の出どころ（route param か body か）が違うだけで文言・ステータスまで同一。
   ここが「片方だけ直る」と、view から押した action だけ state gate が緩む/厳しくなる。

参照ホストの MulmoClaude は 1 ファイルに全ルートがあるので jscpd には出ないが、
同じ重複を `findActionOr404`（`server/api/routes/collections.ts`）で既に共有化しており、
親側ルートと view token 側ルートの両方から呼んでいる。こちらも同じ形にする。

## 置き場所 — 3 つ目のモジュールにする理由

`customViewRoutes.ts` は `collections.ts` を import してはいけない。逆向き
（collections.ts → customViewRoutes.ts）が既にあり、必要な helper は mount 時に
`CustomViewRouteDeps` として渡している。ファイル先頭のコメントがその契約を明記している。

よって共有ガードは**どちらにも属さない新規モジュール**
`server/backends/collectionActionGuards.ts` に置き、両方から import する。
このモジュールが import するのは `@mulmoclaude/core` と express の型だけなので循環しない。

## 出すもの

```ts
// server/backends/collectionActionGuards.ts
export const visibilityGate = (action: CollectionAction): ActionWithWhen => …
export const resolveItemAction = (res, collection, actionId): CollectionAction | null => …
export const refuseReadOnlyCollection = (res, collection): boolean => …
export const resolveActionableRecord = (res, collection, action, itemId): Promise<CollectionItem | null> => …
```

- 応答を自分で返して `null` を返す作法は、collections.ts の既存 `resolveCollection` /
  `resolveView` / `resolveWriteTarget` と同じ。`refuseReadOnlyCollection` だけは
  「405 を返したか」を `boolean` で返す（返す値が無いガードなので）。
- `visibilityGate` は collections.ts から**移す**。`resolveActionableRecord` が使うのと、
  移せば `CustomViewRouteDeps.visibilityGate` の手渡しが 1 本消えるため。
  spec の import 先も新モジュールに変える（再 export はしない）。
- チェックの**順序は現状維持**。view token 側は `collectionWritable` を record 読みの前に、
  親側は `actionVisible` の後に見ている。順序はルートごとの都合なので共有側に畳まない。

## 検証

1. 上の jscpd コマンドで **clone 0 件**（抽出が中途半端だと 50 トークンを割らずに残るので、
   目視ではなく実際に回して確認する）
2. `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
3. 挙動の担保は既存 spec（`test/server/backends/collections.spec.ts`）:
   `action routes (seed prompts)` の 404 2 種、`record-level mutate actions` の 404、
   `custom-view mutate actions` の 403 / 409 / 400 / 404。**どちらのルートも 404 / 409 を
   既に持っている**ので、共有側に畳んだあともルート越しに両方から確認できる。
4. 共有ガード自身の spec を `test/server/backends/collectionActionGuards.spec.ts` に新設。
   `visibilityGate` の既存 describe もそこへ移す（テスト対象と同居させる。collections.spec.ts は
   既に max-lines 警告を出しているので、そこに足さない）。`resolveActionableRecord` は
   `storeFor` 越しにディスクを読むため単体では持たず、上の 3 のルート spec で担保する。
