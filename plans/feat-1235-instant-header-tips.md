# feat(#1235): セルヘッダの hover を即座に・中身のある表示にする

## なぜ `title` をやめるか

依頼は「すぐ出てほしい」。**標準 `title` の遅延はブラウザ仕様で、CSS でも JS でも変えられない。**
中身も1行のプレーンテキストのみ。この2つは `title` を使い続ける限り直せないので、置き換える。

## 出すものは全部もう手元にある

`useWorkItem.ts` が **`prTitle` / `issueTitle` を既に受け取って parse している**（#1014 でスマホ用に
追加され、デスクトップでは一度も表示されていない）。**サーバ変更は不要**。

## 形 — シングルトンの tip レイヤ

chip を wrapper で囲むと **flex の子が1段増えてヘッダのレイアウトが変わる**。ヘッダは
`flex` で `flex-none` / `min-w-0` を細かく効かせているので、そこには触らない。

代わりに:

- `useHoverTip()` が**共有状態**（アンカーの矩形 ＋ 中身）を持ち、既存要素に載せるハンドラを返す
- `<HoverTip>` が**アプリに1つだけ**あり、body へ teleport ＋ `fixed`
- DOM は増えず、同時に2つ出ることも構造的に起きない

teleport ＋ fixed は `CockpitRowMenu.vue` と同じ理由 — セルは `overflow-hidden` なので、
その場に置いた要素は切られる。スクロールで閉じるのも同じ（アンカーが下から抜ける）。

## 中身のデータ形

```ts
type TipSection = { head: string; note?: string };  // head=見出し行 / note=説明行
type TipContent = TipSection[];
```

| chip | 中身 |
| --- | --- |
| work | `[{head:"PR #2689 · CI running", note:<PRタイトル>}, {head:"issue #2688", note:<issueタイトル>}]` |
| git branch | `[{head:"branch fix/…"}, {head:"2 uncommitted · 1 ahead"}]` |
| model / ctx | `[{head:"Claude · opus"}, {head:"context 96,000 / 200,000 (48%)"}]` |
| dir badge / cwd | `[{head:<名前 or フルパス>}]` |
| roster phase | `[{head:<phase の説明>}]` |

**組み立ては純関数**にして単体テストする（`tipContent.ts`）。

## 配置

`placeHoverTip(anchor, tip, viewport)` の純関数。下に出す → 入らなければ上へ反転 → 横は画面内へ寄せる。
セルは9分割まで小さくなり、端の chip は普通に画面際に来るので、**寄せは必須**。

## アクセシビリティ

`title` を消すと支援技術が読むものが無くなる。tip 要素に固定 id ＋ `role="tooltip"` を持たせ、
開いている間だけアンカーに `aria-describedby` を張る（同時に1つなので id は1つでよい）。
**フォーカスでも出す** — work chip の中の `<a>` はキーボードで到達できるのに、hover だけだと何も出ない。

## 変更するファイル

1. `src/composables/hoverTipPlacement.ts` — 配置の純関数
2. `src/composables/useHoverTip.ts` — 共有状態 ＋ ハンドラ
3. `src/components/HoverTip.vue` — 唯一の描画側
4. `src/components/tipContent.ts` — 各 chip の中身を組む純関数
5. `src/App.vue` — `<HoverTip>` を1つ置く
6. `WorkItemChip` / `GitBranchChip` / `ModelContextBadge` / `DirBadge` / `CellShell` / `CockpitHeader`
   — `title` を外してハンドラを付ける

## テストで固定すること

- work の中身に **PR / issue のタイトルが入る**（今まで捨てていた値）。無いときは行が消える
- 各 chip の中身が今の `title` の情報を落としていない
- 配置: 下に入らなければ上／右端・左端で画面内に収まる
- `title` 属性が**残っていない**（二重表示の防止）
- 開いている間だけ `aria-describedby` が張られる
- hover を外すと消える／フォーカスでも出る

## やらないこと

- hover card 化（マウスを中に入れる）— #1235 の決定。リンクは chip の番号自体が既に持っている
- ヘッダ以外の `title`（ツールバー、設定画面）
- ツールチップのための追加の通信
