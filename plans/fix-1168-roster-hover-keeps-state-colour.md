# fix #1168 — cockpit ロスターのホバーで状態色を消さない

## 症状

グリッド表示（zoom + list mode）左側の cockpit ロスターで、`done` の行は背景が薄い緑になる。
その行にポインタを載せると背景が **真っ白** になり、緑が消える。左端の枠線が緑なので行の識別は
かろうじてできるが、状態色は「見ているまさにその瞬間」だけ失われる。

## 原因

行のホバーは cockpit-row（`src/components/TerminalGrid.vue`）に載った `brightness(1.15)` の
フィルタ 1 つだけだった。フィルタは背景の明るさに依存する:

| テーマ | `--bg-panel` | done の平常時 (`#22c55e` 8%) | `brightness(1.15)` 後 |
| --- | --- | --- | --- |
| Daylight | `#ffffff` | `#edfaf2` | `#ffffff`（全チャンネルが 255 に張り付く） |
| Midnight | `#16213e` | `#172e41` | わずかに明るい緑（問題なし） |

ライトテーマでは平常時の色が既に白から数 % の位置にあるため、1.15 倍で全チャンネルがクリップして
純白になる。`blocked` の琥珀（14%）も同じく白へ飛ぶ。ダークテーマでは再現しないので気づきにくい。

## 修正

明度フィルタをやめ、**同じ状態色を少し多く混ぜたホバー背景**を各分岐が自分で名乗る形にする。
色相が変わらないので、どのテーマでもホバー中の行は「少し濃さの違う薄い緑／薄い琥珀」に見える。

- `src/components/rosterAlertClasses.ts`
  - `ROW_DONE`: `hover:bg-[color-mix(in_srgb,#22c55e_18%,var(--bg-panel))]`（平常時 8%）
  - `ROW_BLOCKED`: `hover:bg-[color-mix(in_srgb,#f59e0b_24%,var(--bg-panel))]`（平常時 14%）
  - `ROW_PLAIN` / `ROW_EXPANDED`: テーマの `hover:bg-hover` トークン
- `src/components/TerminalGrid.vue`: cockpit-row から明度フィルタのホバーを外す

各分岐が枠・左端・背景を必ず名乗るという既存の規律に、ホバー背景を 1 つ足した形。競合する
ユーティリティの勝敗は Tailwind の出力順で決まるので、分岐ごとに 1 つだけ書く。

## 既知の制約（意図的）

`blocked` かつ blink 有効の行は、キーフレーム側が `background-color` をアニメーションしている。
CSS アニメーションは通常宣言より優先されるため、この行だけホバー背景が効かない（点滅そのものが
フィードバックになっている）。`!important` で上書きすると、点滅中の行にポインタを載せた瞬間だけ
背景が固まりリングだけ脈打つという不自然な見た目になるため、取らない。
`prefers-reduced-motion` / blink オフの `blocked` 行は静止色なのでホバーが効く。

## テスト

`test/src/components/rosterAlertClasses.spec.ts`

- ホバー背景に状態色（`#22c55e` / `#f59e0b`）が残っていること
- 全分岐が `hover:bg-` を名乗ること（背景を名乗る既存テストと同じ理由）
- plain 行の完全一致テストを `hover:bg-hover` 込みに更新
