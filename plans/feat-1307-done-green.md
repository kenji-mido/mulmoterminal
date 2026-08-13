# feat(grid): done を緑に統一する (#1307)

## 問題

同じ `AttentionStatus` が、タイルセルとコックピットロスターで違う色に出る。

| 状態 | セル（タイル / フィルムストリップ） | ロスター行・サムネイルのドット/ピル | 一致? |
| --- | --- | --- | --- |
| blocked | 琥珀の枠 + リング (`--amber`) | 琥珀のピル + 縁 (`#f59e0b`) | 一致 |
| done | **青**の枠 + リング (`--accent`) | **緑**のピル + 縁 (`#22c55e`) | **不一致** |
| working | 青の枠 + 点滅ドット (`--accent`) | ピルのみ (`#4a9eff`) | 表現差 |
| idle | リポジトリ色 | グレーのピル | 一致 |

`done` だけ色相が変わるので、同じセッションを拡大しただけで「終わった」印が青から緑に変わる。
タイル上では done と working がどちらも青系で、遠目に区別できないという問題も同じ原因。

## 方針

**done = 緑 / working = 青 / blocked = 琥珀** を全ビューで揃える。緑はロスターが既に使っている
`#22c55e` に寄せる（issue の提案どおり）。逆方向（ロスターの done を青にする）は、ロスター上で
running と done の区別が消えるので採らない。

### 色を 1 か所に置く

現状 `#22c55e` は `rosterAlertClasses.ts` と `CockpitHeader.vue` に直書きされている。セル側にも
同じ hex を書き足すと 4 ファイルに散る = また片方だけ変わる。そこで **`--done` トークンを
`src/style.css` の status ブロックに 1 つ置き**、`src/tailwind.css` で `--color-done` に写して
`bg-done` / `border-done` / `border-l-done` / `text-done` を使えるようにする。既存の直書き
`#22c55e`（done を意味しているものだけ）もこのトークンに寄せる。

`--done` はテーマで切り替えない（`THEME_VAR_KEYS` に入れない）。`--ok` などと同じ「意味を運ぶ色」
であり、しかも **枠・リング・ウォッシュ（マーク）としてしか使わず地の文の色にはしない**ので、
`--ok` が明度でひっくり返しているような light テーマ用の別値を要らない。ロスター行は既にこの
`#22c55e` を 4 テーマすべてで使っていて実績がある。

### テストできる形にする

セル側の状態クラスは `TerminalCell.vue` の `<script setup>` 内に閉じていて import できないので、
`src/components/cellStatusClasses.ts` に切り出す（`cellChromeClasses.ts` / `cellParked.ts` と同じ
やり方）。これで「セルの done とロスターの done が同じトークンを名指ししている」ことを spec で
固定できる。docs/grid-view-modes.md が言う「2 か所を `activityStatus()` で歩調を合わせる」構造は
そのままに、色の出どころだけ 1 本にする。

## 変更点

1. `src/style.css` — status トークンに `--done: #22c55e;` を追加。
2. `src/tailwind.css` — `--color-done: var(--done);`。
3. `src/components/cellStatusClasses.ts`（新規）— `CELL_STATUS` / `HEADER_STATUS` / `DOT_STATUS` を
   `TerminalCell.vue` から移設し、`done` を緑にする。
   - `CELL_STATUS.done`: 枠とリングを accent から `--done` に（`border-done` ＋ 40% の color-mix リング）
   - `HEADER_STATUS.done`: `bg-selected border-b-accent` → `bg-[color-mix(in_srgb,var(--done)_20%,var(--bg-panel))] border-b-done`
     （working は `bg-selected` のままなので、ヘッダーだけ見ても両者が分かれる）
   - `DOT_STATUS.done`: `bg-accent` → `bg-done`
4. `src/components/TerminalCell.vue` — 上記を import するだけにする。
5. `src/components/cellParked.ts` — `SUNK_DOT_STATUS.done` を `bg-done` に。
6. `src/components/rosterAlertClasses.ts` — `ROW_DONE` の `#22c55e` を `var(--done)` / `border-l-done` に。
7. `src/components/CockpitHeader.vue` — `DOT_CLASS.done` / `BADGE_CLASS.done` の `#22c55e` を
   トークンに。`PHASE_CLASS.ready` の `#22c55e` は **触らない**（PR のライフサイクル色で、意味が別）。
8. `src/components/AppToolbar.vue` — グリッド全体の集計チップの done が `text-accent`（青）なので
   緑に。ここだけ青のままだと、まさに直したい「done が青」が残る。ただし **`--done` ではなく
   `text-ok`**: ここは塗りではなく文字色で、`--done`（#22c55e）は白パネル上 2.3:1 で AA を満たさない。
   `--ok` は light テーマ用に反転する既存トークンで、`blocked` 側の `--warn`/`--amber` と同じ対応。

## テスト

- `test/src/components/cellStatusClasses.spec.ts`（新規）— 4 状態すべてが値を持つこと、
  `done` が `--done` を名指しし `--accent` を含まないこと、`working` が accent のままであること。
- `test/src/components/doneColour.spec.ts`（新規）— セル（`CELL_STATUS` / `DOT_STATUS` /
  `SUNK_DOT_STATUS`）とロスター（`rosterAlertClass("done", …)`）が同じトークンを名指しすること。
  hex の一致ではなくトークンの一致を固定する（issue の本質は「出どころが 1 つか」なので）。
- 既存 spec の hex 直書きアサーションを更新: `rosterAlertClasses.spec.ts`, `TerminalGrid.spec.ts`。

## 検証（build が通る ≠ 見えている）

1. `yarn format` / `lint` / `typecheck` / `build` / `test`。
2. **ビルド後の CSS を grep** して、新しいユーティリティ（`border-done`, `bg-done`,
   `border-l-done`, `text-done`, done の `color-mix`）が実際に出力されていることを確認する。
   Tailwind はソースに**リテラルで**現れたクラスしか出さないので、ここが本当の落とし穴。
3. ビルド済み CSS を読み込む静的ページで 4 状態 × dark/light を実描画し、スクリーンショットを取る。

## ドキュメント

「done = 青リング」と書いてある現行ドキュメントを全部直す（日付入りの `v*.md` スナップショットは
**直さない** — 当時の挙動の記録なので）。

- `README.md`（グリッド画像のキャプション）
- `docs/guide/{en,ja}/basics.md` / `features.md` / `index.md` / `scenarios.md` / `glossary.md` /
  `getting-started.md`
- `docs/index.md`
