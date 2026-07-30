# feat: ランチャのディレクトリチップを orderPriority 順に並べる（#1097）

Issue: #1097 / Branch: `feat/1097-chip-priority-order`

## User Prompt

> 今並んでいるのって開いた順だよね。a-z に sort のほうが見やすいかな。
>
> あー、ちがうな。各 dir の order の指定があるものに関してはそれを優先して、だからサイドメニューの
> order と同じ順で良いのか。指定がない部分はいままでどおりで。

## 現状の並び

チップは `config.json` の `cwdPresets` の配列順そのまま（`TerminalCell.vue` の `v-for="p in presets"`）。
この配列は **MRU**：`recordPreset` が起動のたびにその dir を先頭へ移動する
（`src/composables/useAppConfig.ts`）。`npx mulmoterminal init` の初期生成もセッション mtime の
新しい順（`server/config/cwd-presets.ts` の `deriveCwdPresets`）。

数が増えると探しにくく、起動のたびに並びが変わるので位置でも覚えられない。

## 決定（対話で確定）

- **a-z ではなく `orderPriority` 順**。グリッドの priority ソートが既に使っている規則をそのまま使う。
  ユーザーは既に 10 個の dir に 20/30/…/120 を振っており、それがサイドメニューの並びと一致する。
- **指定が無い dir は従来どおり**：rank を持つ全 dir の後ろ、相対順は現状の MRU のまま。
- **表示順だけ変える。保存される `cwdPresets` は MRU のまま。**
  `recordPreset` の「先頭なら書かない」最適化と `sanitizePresets` のデデュープ（新しい方の
  ラベルを残す）が、保存配列が MRU であることに依存しているため。
- 適用は**ランチャのチップのみ**。設定モーダルの dir 一覧は別途判断（対象外）。

## 実装

### 1. `src/components/dirPriorityOrder.ts`（新規）

「未設定 = Infinity」＋安定ソートの規則を 1 箇所に置く。`gridTabs.ts` に閉じていた
`UNSET_PRIORITY` / `cellPriority` をここへ移し、グリッドとチップの両方が同じ関数を読む。

- `UNSET_PRIORITY` — `Number.POSITIVE_INFINITY`
- `dirPriority(cwd, priorityByCwd)` — 未設定・cwd なしは `UNSET_PRIORITY`
- `orderByDirPriority(items, cwdOf, priorityByCwd)` — 安定ソート

### 2. `src/components/gridTabs.ts`

`cellPriority` を新モジュールの `dirPriority` へ委譲。`orderCells` の
「launch セルは常に最後」レベルはセル固有なので残す。挙動不変（既存 spec が回帰テストになる）。

### 3. `src/components/TerminalCell.vue`

`useDirColors(presetPaths)` と同じ形で `useDirPriorities(presetPaths)` を引き、
`orderByDirPriority` を通した `orderedPresets` を描画する。

## テスト

`test/src/components/dirPriorityOrder.spec.ts`（新規）:

- 昇順に並ぶ / 未設定は最後で相対順は保つ / 同 rank は入力順維持（安定）
- 全部未設定なら並び替えない / 負値が 0 より前 / 空配列
- `cwdOf` が null を返す要素は未設定と同じ扱い

既存 `test/src/components/gridTabs.spec.ts` の `orderCells (priority sort)` が
グリッド側の挙動不変を保証する。

## 対象外

- スマホ起動画面、設定モーダルの dir 一覧
- `orderPriority` を GUI から編集する機能（今は `.mulmoterminal.json` を直接編集）
