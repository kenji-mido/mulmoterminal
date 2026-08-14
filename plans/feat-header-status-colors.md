# feat(chrome): ヘッダーの状態色をユーザーが指定できるようにする（#1617）

Issue: #1617（#1591 の続き） / Branch: `feat/1617-header-status-colors`

## User Prompt

> https://github.com/receptron/mulmoterminal/issues/1591#issuecomment-5238654452 これの続きだね。
> running などで header の色が変わると字の色とかぶって読めない問題はあるので、改善。
> ユーザが柔軟に指定できるのが良いので、それ含めて検討して、細かく設定できるようにして。
> 設定用の skill も更新してね

## 症状の実測（推測ではなく、報告スクリーンショットのピクセル値）

報告画像を BMP に変換して直接サンプルした。

| 位置 | 値 | 正体 |
| --- | --- | --- |
| ヘッダー背景（idle） | `#8e44ad` | ディレクトリの `headerColor` |
| ヘッダー背景（working） | `#d6e4fb` | Daylight テーマの `--bg-selected` |
| その上の文字（working） | `#f6fcff`〜`#fcffff` | 宣言された `headerTextColor`（白） |

白 on `#d6e4fb` = **1.15:1**。

## 根本原因

`HEADER_STATUS.working` / `.done` はヘッダー**背景を差し替える**（`src/components/cellStatusClasses.ts`）。
インクは追従していない:

- **導出**インクは既に落ちている — `headerStyleFor(bg, text, dirBackgroundShows)` の第3引数に
  `status === "idle"` が渡り（`TerminalCell.vue:934`）、`cellHeaderStyle.ts` は
  「ディレクトリ背景が出ていないなら導出しない」と決めている
- **宣言**された `headerTextColor` はその判定より**手前で return される**ので、wash の上に残る

`blocked` だけは偶然無事（`text-warn` を名指しし、`--cell-header-fg` を含まない）。

## 決定（対話で確定）

1. **既定動作**: 宣言された `headerTextColor` も導出インクと同じ規則に従う。
   ディレクトリ自身の背景が出ている状態でだけ効く。working / done はテーマのインク × テーマの wash
   という、元々セットで設計された組み合わせに戻る。
2. **粒度**: 状態ごとに `background` と `text`（`text` 省略時は `background` から AA 導出）＋
   「状態でヘッダー色を変えない」スイッチ。
3. **置き場所**: グローバル（`~/.mulmoterminal/config.json`）とディレクトリ（`.mulmoterminal.json`）の両方。
   ディレクトリが勝つ。

## 設定の形

```jsonc
{
  "headerColor": "#8e44ad",            // 変更なし。これが idle の状態そのもの
  "headerTextColor": "#ffffff",

  "headerStatusColors": {
    "working": { "background": "#6d28d9" },
    "done":    { "background": "#166534" },
    "blocked": { "background": "#7c2d12", "text": "#ffe8a3" }
  },
  "headerStatusTint": "background"     // 既定。"none" にすると working/done で headerColor を保つ
}
```

- **`idle` は入れない。** `headerColor` / `headerTextColor` が idle そのものなので、
  `headerStatusColors.idle` を許すと同じピクセルに答えが 2 つできる。
- 1 状態あたりの優先順位: `headerStatusColors[status]` → `headerStatusTint` → テーマの wash。
- `text` 省略時は `headerTextColorFor(background)`。`headerColor` が既に通っているのと同じ関数を通すので、
  **背景だけ指定して読めなくなることが原理的に起きない**。

### レビューしてほしい決定: `none` は `blocked` を黙らせない

`headerStatusTint: "none"` は `working` / `done` にだけ効く。`blocked` は
「答えるまで何も進まない」唯一の状態で、「自分の配色を保ちたい」という目的のスイッチが
amber を消してしまうのは事故。別の色にしたいディレクトリは `headerStatusColors.blocked` を
明示すれば通る。

## 実装

`cockpitLines` と同じ層の切り方に合わせる（common に純粋な規則、client に反応的ストア、server に検証）。

| 層 | ファイル | 何をするか |
| --- | --- | --- |
| common | `common/headerStatusColors.ts`（新規） | 型・既定・sanitize・**純粋な解決関数**。両側がここから決める |
| common | `common/dirChrome.ts` | `headerStatusColors` / `headerStatusTint` を `DirChrome` に追加 |
| server | `server/config/config-schema.ts` | `writableDirConfigSchema` に 2 キー追加（JSON Schema にも出る） |
| server | `server/config/dir-config.ts` | `loadDirConfig` / `publicDirConfig` で読む |
| server | `server/config/app-config.ts` | `AppConfig` にグローバル既定を追加 |
| client | `src/composables/headerStatusColors.ts`（新規） | `/api/config` から hydrate するシングルトン |
| client | `src/composables/useDirConfig.ts` | dir config の parse に 2 キー追加 |
| client | `src/components/cellHeaderStyle.ts` | 状態を見て `--cell-header-bg` / `--cell-header-fg` を決める |
| client | `src/components/cellStatusClasses.ts` | working/done/blocked の背景を `var(--cell-header-bg,<wash>)` に |

`HEADER_STATUS` 側を `var(--cell-header-bg, …)` にするのが要点。設定がない状態では
`--cell-header-bg` を**出さない**ので、これまでどおり wash が出る。設定があるときだけ変数が立つ。

## テスト

- 解決関数の表駆動テスト（状態 × 設定の有無 × tint モード）
- 「`text` 省略なら AA を満たす」を**計算で**確認する spec（色を目で選ばない）
- `headerStatusTint: "none"` でも `blocked` は wash のままであること
- 既存の `cellHeaderStyle.spec.ts` / `cellStatusClasses.spec.ts` / `TerminalCell.spec.ts` の回帰

## 実測（build 成功 ≠ 動作する）

**ビルド後の実 CSS を実ブラウザ（puppeteer）に読ませ、報告写真に写っている要素そのもの**
（model バッジ / usage チップ = `text-[var(--cell-header-fg,var(--text-dim))]`）の
computed color を、ヘッダーの computed background に対して測った。4 テーマ × 4 状態 × 4 ルール = 64 レンダ。

daylight / working（報告者の条件）:

| 何 | 背景 | インク | 比 |
| --- | --- | --- | --- |
| 4.8.1（報告写真の実測） | `#d6e4fb` | `#ffffff` | **1.15:1** |
| 本 PR・無設定 | `#d6e4fb` | `#8492a8`（`--text-dim`） | **2.46:1** |
| `headerStatusColors.working: "#ffe8a3"` | `#ffe8a3` | `#1b2430`（導出） | **12.91:1** |
| `headerStatusTint: "none"` | `#8e44ad` | `#ffffff` | **5.87:1** |

**残る 2.46:1 は本 PR が作ったものではない。** working / done / blocked で本 PR は変数を
**1 つも出さない**ので、そのときの style 属性は無設定のディレクトリと**バイト同一**であり、
2.46:1 はテーマ既定の `--text-dim` × wash の組み合わせ、つまり**現在すでに全員が見ている値**。
4 テーマ全部で 1.90〜3.10:1（nord done が最悪の 2.06、solarized done が 1.90）。

→ **別issue候補**: wash がヘッダーを持っているあいだチップのインクを `--text-dim` から
`--text` に上げるか。全ユーザーの見た目が変わるのでこの PR には入れない。

CSS 側の回帰も同時に確認済み: `bg-[var(--cell-header-bg,<wash>)]` に包み替えても、
working=`--bg-selected`、done=`color-mix(--done 20%, --bg-panel)`、blocked=`--warn-bg-subtle` は
包む前と同じ値に解決している（入れ子の `color-mix` フォールバックも生成されている）。

## ドキュメント（この機能の持ち主）

- `server/skills/mulmoterminal-dirs/SKILL.md` — この設定の持ち主。書き方をここに書く
- `server/skills/mulmoterminal-config/SKILL.md` — router なので 1 行の行き先だけ
- `README.md` / `docs/guide/{en,ja}` — 既存の headerColor の節に追記

## 対象外

- これ専用の Settings カラーピッカー UI。他の 7 色と同じく skill が書く。
