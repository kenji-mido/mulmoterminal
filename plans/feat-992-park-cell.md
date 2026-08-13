# feat #992 — 寝かせたセルを沈める（park）

## 要望

> ターミナルをいっぱい開いているときに、寝かしているterminalは一旦disabledにするか、
> headerだけ残して閉じれたほうが認知負荷が減るかも知れない

現在の回避策は、寝かせたいセルで `/clear` を打つこと。履歴が消えるのが代償で、閉じるのは
セッションごと消えるので選べない。**開いたまま、履歴を保ったまま、寝ていると分かる**状態が要る。

## `/clear` が効いてしまう理由

ヘッダー文字列は `memo > aiTitle > lastPrompt > セッション id 先頭` の順で決まる（`cellHeaderText`）。
`/clear` すると aiTitle と lastPrompt が**明示的な null** で届き（`applyActivityPush` はこれを
「今は無い」として反映する）、ヘッダーが id 先頭まで落ちて「空っぽに見える」。

つまり今起きているのは、**表示状態を変えたいのに会話状態をリセットして代金を払っている**。
履歴が消えるのは副作用ではなく、その手段の本体コスト。

## 前提: 画面は 3 モードある

詳細は [`docs/grid-view-modes.md`](../docs/grid-view-modes.md)。この設計に効く点だけ再掲する。

- **セルのコンポーネントは 1 組しかない。** `.grid` は常に全セルを描画し、拡大中のものだけが
  `<Teleport>` で `.zoom-main` に移動する。**タイルとサムネイルは同じ `TerminalCell`**。
- **ロスター行は `TerminalCell` ではない。** 別テンプレート（`listRows` + `rosterAlertClass()`）。
  セル側をどういじってもここには届かない。
- **母集団が違う。** 未拡大は現ページの ≤9、拡大中は全ページの全セル。

したがってコードの継ぎ目は「拡大中／未拡大」ではなく、**セル本体（タイル＋サムネイル）と
ロスター行**の 2 つ。

## 決めた形

**両方に入れる。** セル本体は opacity で沈め、ロスター行には 5 番目の静かなスタイルを足す。
どのモードでも同じことを言う状態にする。

**この形が解かないこと**を明記しておく: `auto`（attention-first）は配列全体を並べ替えてから
ページを切るので、寝かせたセルが `done` で 1 ページ目へ浮上してくる件は解決しない（沈んだ
見た目のまま浮上してくる）。sort 側に「寝かせ」順位を足すのは別の変更で、必要ならこの上に載る。

**対象は `TerminalCell`（セッションのターミナル）だけ。** `CommandCell` は ephemeral で永続化
されず、`LauncherCell` は起動前の枠。`gridCellProps` に混ぜず、`uid` / `session` / `cwd` と同じく
セル種別ごとに明示して渡す（共有 props に入れると 3 コンポーネント全部が宣言する羽目になる）。

## 設計

### parked は `AttentionStatus` に足さない

`AttentionStatus`（blocked / done / working / idle）は**誰の番か**を表し、グリッド・ロスター・
サイドバー・タブバーが共有している（`attentionStatus.ts`）。parked は**ユーザーの表示都合**で
直交する概念。5 番目のメンバーとして足すと 4 パネル全部が解釈する羽目になる。
**独立したフラグとして重ねる。**

### 保存先は `Cell` の `parked?: true`

`GridState` は `localStorage` の `grid_v2` に丸ごと永続化される（`GridView.vue` の
`watch(state, persist, { deep: true })`）。

- **リロードをまたぐ**
- **`/clear` `/compact` をまたぐ** — Claude は両方で session_id を振り直すが
  （`activity-hook.ts`）、cell の identity は uid なので影響を受けない
- 位置を保つ形＝グリッドの概念なので、セッションではなく cell に持たせるのが筋が通る

`agent` と同じ idiom に従う: **不在＝寝ていない**。`exactOptionalPropertyTypes` の下では明示的な
`parked: undefined` と不在は別物で、JSON を往復して残るのは不在だけ。解除はキーを消す。

**`parseGridState()` は各セルをフィールド固定で組み直している。** ここに `parked` を足さないと
**リロードで黙って消える**（型は通り、テストを書かない限り誰も気づかない）。

### 沈める条件

`parked && status !== "blocked"`

- **`blocked` は例外** — 寝かせたせいで許可待ちに気づかないのは、認知負荷を下げるどころか事故
- **`done` は沈めたまま** — 寝かせた agent がターンを終えるのは寝かせた結果として当然で、そこで
  浮き上がると寝かせた意味が無い。`blocked` だけが「答えるまで何も進まない」
- **拡大しても沈んだまま** — 当初は「見ているものは沈めない」にしていたが、それだと
  **寝かせたセッションを確認しに行った操作そのものが寝かせを解除する**。拡大は「起こさずに読む」
  ための操作なので、沈みは保つ。ロスター行も同じで、選択中の行は青い縁（＝「ここにいる」という
  ナビゲーション）を保ったまま沈める。縁か沈みのどちらかを落とすと、聞かれていない質問に答えて
  しまう

### 起こすのは「入れたとき」

拡大では起きないので、代わりに**ターミナルへの入力で起こす**。`ConnHandlers.onInput` を足し、
`wireTerminalInput` の `send`（キー入力・バインドされたキー・貼り付けが全部通る唯一の場所）から
発火する。**サーバが書き戻す出力からは到達できない**のがこの位置を選んだ理由。

`send` の**先頭**で呼ぶ（ソケットが落ちていても発火する）。寝かせたセルが読み取りたいのは
「誰かがこれを使っている」であって「PTY が受け取った」ではないため。

**ただし「入力が来た」と「ユーザーが打った」は同じ質問ではない。** マウス追跡中のアプリでは
**クリックもホイールも入力として同じ経路を通る**（アプリ自身が `term.input()` で流し込んでいる）。
そのままだと**読むためにクリックしただけで起きてしまい**、寝かせの意味が無くなる。
`isTypedInput()`（`terminalUserInput.ts`）で、SGR / X10 のポインタレポートとフォーカス
レポート（mode 1004。クリックはフォーカスも動かすので裏口になる）を除外する。
**レポート自体は今までどおり PTY へ送る** — 除外するのは「打った」と数えることだけ。

矢印キーや Home/End も `ESC[` で始まるので、「`ESC[` で始まれば入力ではない」にはできない。
判定は形で行う。

### Tailwind の競合を踏まない

同じプロパティを 2 つのユーティリティが取り合うと勝つのは Tailwind の出力順で、こちらの意図では
ない（`CELL_STATUS` / `HEADER_STATUS` / `DOT_STATUS` / `ROW_*` が全ブランチで自分の色を名指しして
いるのはこのため）。

したがって沈む見た目は **status ブランチが一切触っていないプロパティだけ**で作る = `opacity`。
`bg-*` / `border-*` には手を出さない。

working ドットの拍動（`animate-cell-pulse`）は止める — 認知負荷の実体は動くものなので、ここが
効く。ただし `DOT_STATUS.working` を条件で書き換えるのではなく、**沈んでいるとき用のマップを
もう 1 枚**持って選ぶ（既存の「どのブランチも自分の値を名指しする」形をそのまま踏襲する）。

### ロスター行の優先順位

`expanded` → `blocked` → `parked` → `done` → plain。

`ROW_PARKED` も他のブランチと同じく枠線・左端・背景を自分で名指しし、沈みは `opacity` で足す。

### 接続は切らない

issue の設計メモどおり **セッションは切らない / 畳むのは表示だけ / 戻したときに履歴が消えないこと**。
WebSocket も xterm も生かしたままにする（購読を止めると復帰時にスクロールバックが欠ける）。

## 実装

| ファイル | 変更 |
| --- | --- |
| `src/composables/mouseReports.ts` | `isMouseReport()`（SGR を書いている場所と同じファイル） |
| `src/composables/terminalUserInput.ts`（新規） | `isTypedInput()` — ポインタ／フォーカスレポートを除外 |
| `src/composables/useTerminalConnections.ts` | `ConnHandlers.onInput`、`send` から `isTypedInput` 越しに発火 |
| `src/components/Terminal.vue` | `onInput` を `input` イベントとして上へ |
| `src/components/gridTabs.ts` | `Cell.parked?: true`、`setCellParked()`、`parseGridState` の復元に追加 |
| `src/components/cellParked.ts`（新規） | 純関数 `isCellSunk()` と沈み用クラス／ドットマップ |
| `src/components/cellChromeClasses.ts` | 静止版の working ドット |
| `src/components/rosterAlertClasses.ts` | context に `parked`、`ROW_PARKED` ブランチ |
| `src/components/TerminalCell.vue` | prop `parked`、ヘッダーのトグル、沈みクラスの適用 |
| `src/components/TerminalGrid.vue` | `CockpitRow.parked`、セルへ `parked` を渡す、`park` を uid で emit |
| `src/components/GridView.vue` | `park` を受けて `setCellParked`、`rosterRow` に `parked` |

トグルは Material Symbols の `bedtime`（寝かせ中は accent 色）。**絵文字は使わない。**

## テスト

- `test/src/components/cellParked.spec.ts` — `isCellSunk` を parked × expanded × 4 status で固定。
  **blocked では沈まない**、**拡大中は沈まない**を明示的に持つ
- `test/src/components/rosterAlertClasses.spec.ts`（既存に追記） — 優先順位。特に
  **parked かつ blocked は blocked が勝つ**
- `test/src/components/gridTabs.spec.ts`（既存に追記） — `setCellParked` の往復、解除でキーが
  **消える**こと、**`parseGridState` が `parked` を復元すること**（これが無いとリロードで黙って消える）
- TerminalCell のコンポーネント spec — 沈んだセルが `animate-cell-pulse` を持たないこと

## 関連

- #991（判断だけを人間に届ける）と方向は同じ
- #1131 / #1139（blocked と done を色で分ける）— parked はその上に重なる直交した軸
- [`docs/grid-view-modes.md`](../docs/grid-view-modes.md) — 3 モードの実際
