# fix(#1591): ヘッダー上のチップが headerColor に追従せず読めなくなる

## 症状

ディレクトリの `.mulmoterminal.json` で `headerColor` を彩度の高い色にすると、セルヘッダー上の
`Sonnet · ctx 39%`（model/context バッジ）と `↑90.9M ↓712k`（usage チップ）が背景と同化して読めない。
隣の path（`Home`）とタイトルは追従しているのに、この 2 つだけが取り残される。

## 原因

ヘッダーの ink は `--cell-header-fg`（`headerTextColor` から `cellHeaderStyle.ts` が出す CSS 変数）を
先に見る、という規約がすでにある。

- `CELL_DIR` … `text-[var(--cell-header-fg,var(--text-dim))]`
- `GitBranchChip` / `WorkItemChip` / `WorktreeEnvChip` … `text-inherit` ＋ `currentColor` 由来の塗り

取り残されていたのは、規約に接続されていない 3 つだけ。

- `ModelContextBadge.vue` … `text-dim`
- `TerminalCell.vue` の usage チップ（`data-testid="cell-usage"`）… `text-dim`
- `TerminalCell.vue` のカスタムチップ（`data-testid="cell-hdr-chip"`）… `text-dim`

`text-dim` はテーマのパネル面に合わせて選ばれた色なので、ディレクトリ色で塗られたヘッダーの上では
「背景に近い色」になり得る。

## 方針 その1（最小・接続のみ）

チェーンを 1 本の定数にして、3 箇所をそこに接続する。`headerTextColor` 未設定時に `headerColor` から
自動導出する案は**採らない**（下記「やらないこと」）。

1. `cellChromeClasses.ts` に `CELL_HEADER_INK_DIM = "text-[var(--cell-header-fg,var(--text-dim))]"` を追加し、
   既存の `CELL_DIR` もそれを使う（同じ文字列が 2 箇所に並ぶのを避ける）。
2. `ModelContextBadge.vue` / usage チップ / カスタムチップを `CELL_HEADER_INK_DIM` に接続。
3. spec で固定する。変数名は `cellHeaderStyle.ts` との契約なので、定数ではなくチェーンの
   **リテラル**を assert する。
   - `test/src/components/ModelContextBadge.spec.ts`
   - `test/src/components/TerminalCell.spec.ts`（両チップを描画済みの既存テストに追加）

未設定のディレクトリでは `--cell-header-fg` が無いのでフォールバックの `--text-dim` が効き、
見た目は現状と 1px も変わらない。

## 方針 その2（自動導出・Codex レビューを受けて追加）

その1 は `headerTextColor` を設定しているユーザーしか救わない。issue の Steps to reproduce は
`headerColor: #e8341c` **だけ**を設定する手順なので、報告どおりに再現した人には何も起きない
（PR #1592 の Codex レビュー指摘）。そこで導出を入れる。

導出そのものより、**「いつ導出してよいか」**が設計の中身になる。`working` / `done` / `blocked` の間、
セルヘッダーの背景は状態色に置き換わる（`cellStatusClasses.ts` の `HEADER_STATUS`）。
そこで dir 色から導いた白文字を出すと、明るいテーマでは薄緑のウォッシュの上に乗って**かえって読めない**。

- `headerStyleFor(background, text, dirBackgroundShows)` に第3引数を足し、
  **「いま実際にディレクトリの色が出ているか」**を呼び出し側に答えさせる（既定値なし。
  新しい呼び出し側が黙って間違えないように）。
  - 常に dir 色を塗るヘッダー = `true`（`CockpitHeader` のバー、フィルムストリップ、
    `terminalHeaderStyleFor` のターミナル行、`CellShell` のコマンド/ランチャセル）
  - `TerminalCell` の row 1 だけ `status === "idle"`。そのため header style は `useCellChrome` からではなく
    セル側で計算する（status を知っているのはセル側だから）。
- 導出の値は `common/chromeFromColor.ts` の `headerTextColorFor()` に切り出して共有する。
  repo.json の brand color から chrome を作るときと**同じ答え**になり、同じディレクトリが 2 つの色で
  書かれることがなくなる（`#000` → `#1b2430` / `#fff` → `#ffffff` のマッピングもそこ）。
- 宣言された `headerTextColor` は常に優先。導出は「宣言していないディレクトリ」だけに答える。

計測メモ: issue の `#e8341c` は WCAG では**黒**が選ばれる（黒 4.94:1 / 白 4.27:1）。
「強い赤には白」という直感とは逆で、これは spec にも数字ごと書いてある。

## 方針 その3（near-black の softening は AA を割るときだけ諦める）

その2 のレビューで Codex がさらに指摘: 導出した near-black `#1b2430` は `#e8341c` に対して **3.68:1** で AA 未満。
`#1b2430` は「淡いヘッダーが印刷物みたいに見えないように」黒を和らげた色で、その和らげがコントラストの持ち出しになる。
中間調の背景ではその持ち出しが AA を割る。

- `inkFor()` を、白側はそのまま、黒側は「softened が 4.5:1 を満たすならそれ、満たさないなら純黒」に変更。
- 純黒/純白は必ず AA を満たす（黒と白が同点になる最悪の背景でも 4.58:1）。したがってこの規則は**常に** AA 以上を返す。
- 例示 3 つでは規則の分岐を保証できないので、spec は **4096 色の走査で最小コントラストが 4.5 以上**であることを検査する。
- この修正は repo.json 由来の chrome にも同時に効く（同じ `inkFor`）。同じ欠陥だったので、両方直るのが正しい。

## やらないこと（と、その理由）
- **`RateLimitGauge.vue`**。issue 本文は原因として挙げているが、これは `AppToolbar.vue` にしか置かれておらず
  （アプリのツールバー）、`headerColor` の影響を受けない。`ctx %` を出しているのは `ModelContextBadge.vue`。
- **コックピットロースターの `reply` 行**。ディレクトリ色を塗るのは行の上部バー（`CockpitHeader`）だけで、
  本文の背景は `rosterAlertClasses.ts` のテーマ面（`bg-panel` ＋ 状態ウォッシュ）。`headerColor` の上には
  乗っていないので、この修正の対象外。読みにくさが残るならテーマ側（`--text-dim` のコントラスト）の別件。
- **カスタムチップの `border-border`**。ヘッダー上で薄くなるのは ink と同じ理屈だが、`border-current` にすると
  未設定時の見た目が変わるため、最小の範囲から外した。

## 検証

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
- ビルド後の CSS に `.text-\[var\(--cell-header-fg\,var\(--text-dim\)\)\]` のルールが実在すること
  （クラス名だけ変えて Tailwind が生成していない、という失敗を潰す）
- 実機: `headerColor` だけを設定したディレクトリで、idle のセルヘッダーの文字（パス / ctx / usage /
  カスタムチップ）が読めること。作業中にすると状態色のヘッダーに戻り、そこでも読めること。
  何も設定していないディレクトリで見た目が変わらないこと。
