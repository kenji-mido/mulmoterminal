# 拡大時の一覧で「入力待ち」の行を目立たせる (#1131)

## 何を直すか

拡大時に左（または下）に出る一覧の行で、状態を伝えているのは 8px のドットと 10px のバッジだけ。
行そのものが持つチャンネル（左端 3px の線・行の地）は状態に使われておらず、左端の線は
「いま拡大中の行」の青に使われている。さらに状態のドットとバッジは**ディレクトリの設定色で
塗られたバーの上**に乗っているので、オレンジ系の色を設定したディレクトリでは `waiting` の
amber が埋もれる（#1106 と同型）。

grid のセル自体は `blocked` に amber を 3 チャンネル使っている。**弱いのは一覧だけ。**

## 決めたこと

| 状態 | 表現 | 強さ |
|---|---|---|
| `blocked`（許可・質問で止まっている） | 行を囲む amber の**リング** + 左端の amber 線 + 薄い amber の地、**点滅する** | 強 |
| `done`（ターンが終わって未読） | 細い緑のリング + 左端の緑線 + ごく薄い緑の地、**点滅しない** | 弱 |
| `working` / `idle` | 現状のまま | — |

- 設定で on/off、**既定は on**
- `prefers-reduced-motion` では点滅せず、静的な強調に落ちる
- **拡大中の行には出さない。** その行は「いま見ている」行で、そこが入力待ちなら画面にプロンプトが
  見えている。左端の線は拡大中を示す青のまま（1 本の線に 2 つの意味を持たせない）

## 点滅させる対象を「文字以外」に限る

行の opacity を振ると**文字が点滅して読めなくなる**。動かすのは
**左端の線の色と行の地の濃さだけ**にする。文字・memo・要約は一定のまま。
「うざい」の主因は文字のちらつきなので、ここで大半が消える。

## 実機で見て変えたこと — リングが要る

最初の実装は「左端の線 + 行の地」だけだった。**実際に撮ってみたら意図が効いていなかった。**

行の上半分は `CockpitHeader` が**ディレクトリの設定色**で塗っている。だから地の色は
バーの下の細い帯にしか出ず、さらに**琥珀系の色を設定したディレクトリでは、バーそのものが
「待ち」に見える**（`done` の行なのにバーが茶／琥珀で、本当の状態は 3px の左端にしかない）。
直そうとした問題を場所を変えて再現しただけだった。

対処: **行を囲むリング（`box-shadow`）を状態の主チャンネルにする。** リングは行のボックスの
外側なので、ディレクトリ色が覆えない。grid のセルが `blocked` / `done` に既に使っている
`shadow-[0_0_0_2px_…]` と同じ手法。

教訓として: 自分の書いたクラスが付いていることを確認しても、**画面で意図が達成されている
こととは別**だった。computed style だけ見て通していたら気づかなかった。

## 置き場所

| もの | どこ | 理由 |
|---|---|---|
| keyframes | `src/tailwind.css` の `@theme`（`--animate-cell-pulse` の隣） | コンポーネントに CSS を書かない規約。keyframes だけが utility で書けない |
| 行のクラスを決める純関数 | `src/components/rosterAlertClasses.ts` | `dirChipColor.ts` と同じ形。ユニットテストで固定する |
| on/off の設定 | `src/composables/useRosterAlert.ts`（localStorage） | `useTerminalScrollSpeed` と同じ作法。**見ている人の環境**の設定で、ホストの設定ではない |
| UI | `SettingsModal.vue` に 1 セクション | 「設定で on/off」の入口。config.json に書く設定ではないので skill は増やさない |

色は amber `#f59e0b` / 緑 `#22c55e` を直書きする — 一覧の色は既に
「token-less roster hues」として直書きされており（`CockpitHeader.vue`）、そこに合わせる。

## 手順

1. `src/tailwind.css` に `--animate-roster-alert` と keyframes を足す
2. `rosterAlertClasses.ts`: `rosterAlertClass(status, { blink, expanded })` を書く
3. spec: 状態 × blink × expanded の組み合わせを固定する
4. `TerminalGrid.vue` の `cockpit-row` の `:class` に足す（拡大中の分岐は関数側に寄せる）
5. `useRosterAlert.ts` + `SettingsModal.vue` のチェックボックス
6. `TerminalGrid.spec.ts` に「blocked の行にクラスが付く / 拡大中の行には付かない」を足す
7. `yarn format` / `lint` / `typecheck` ×3 / `build` / `test`
8. **実機で 3 条件を測る**（下記）

## 実機で確認したこと（隔離 HOME、shell セル 3 つ、`/api/hook` に本物の Notification / Stop）

| 条件 | 測った値 | 結果 |
|---|---|---|
| 既定 | 0.8 秒あけて `box-shadow` を 2 回サンプル: `0.737 alpha / 2.94px` → `0.318 alpha / 1.07px` | **本当に動いている** |
| 設定 off | `animation-name: none`、リングは `rgba(245,158,11,0.6) 0 0 0 2px` のまま、2 回のサンプルが同一 | **色は残り、動きだけ止まる** |
| `prefers-reduced-motion: reduce` | 設定は on のまま `animation-name: none`、リングは残る | **OS の設定が勝つ** |
| 拡大中の行が `blocked` | 左端は青 (`rgb(74,158,255)`)、点滅なし | **見ている行は騒がない** |
| Settings のチェックを外す（**リロードなし**） | `animation-name` が `roster-alert` → `none`、リングは `0.6 / 2px` で残る。戻すと再開 | **その場で効く** |

## やらないこと

- **サイドバー（Sessions 一覧）は触らない。** あそこも `blocked` と `done` が太字だけで区別
  できていない（`Sidebar.vue:82,86`）が、別 issue にする
- タブバー、grid のセルヘッダ、音・push 通知
- 状態判定 (`activityStatus()`) の変更

## 意識している副作用

**動くものが画面に 2 種類になる。** 一覧の `working` 行には既に回るスピナーがあり、そこに
`blocked` の点滅が加わる。#1107 で「1 チャンネル 1 意味」に整理した直後の逆行なので、
意識的な判断として記録する — 点滅は**同時に存在しうる中で一番急ぐ状態**にだけ付き、
設定で切れる。
