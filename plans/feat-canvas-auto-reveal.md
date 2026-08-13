# feat: Canvas への描画で自動的に Expand する / 1ターミナルでも Expand できるようにする

2026-08-03。オーナーの依頼と、実機で見つかった失敗から。

## やったこと

1. **タイル表示（何も Expand していない状態）で MCP が Canvas に描画したら、そのセルを Expand して
   Canvas ペインを開く。** 実装は `GridView.vue`（全セルのセッションを購読）。描画された結果かどうかの
   判定は `src/utils/drawnResult.ts` に切り出し、`TerminalGrid.vue` の既存経路と共有する。
2. **`toggleExpand` / `zoomAt` から「稼働セルが2つ未満なら Expand しない」(#374) を撤廃した。**

## なぜ 2 が必要だったか（元に戻さないための記録）

#374 の判断そのものは筋が通っている。Zoom は「1つを大きく、残りをフィルムストリップに」なので、
切り替える先が無ければ、動いているレイアウトを空のフィルムストリップに置き換えたうえで、ターミナルの
ステータスバーと入力欄を画面下に押し出すだけ — 得るものが無い。**issue を読み直すと今でも正しく見えるので、
issue だけから再導出するとこのガードに戻り着く。** だからここに理由を残す。

その読みが見落としていたのは、**右ペイン（Canvas / Tools / Files）が zoom 行にしか存在しない**こと
（`TerminalGrid.vue` の `.zoom-row`）。タイル状態のセルの横には何も置けない。つまり1ターミナルのグリッドでは、
このルールはレイアウトを断っていただけでなく、**ペインそのものを到達不能にしていた**：

- 未読 Canvas チップをクリックしても何も起きない
- エージェントが Canvas に描いても、表示する場所が無い

発見の経緯もそれ。上記 1 の自動 Expand を1ターミナルのグリッドで試したら **何も起きなかった**。
この失敗にはどこにもエラーが出ない — 呼び出し側は zoom を要求し、状態側は静かに断り、機能は
「動かない」ように見えるだけ。原因の特定に時間がかかったのはそのため。

#374 が天秤にかけたコストも、見た目ほど大きくない。大きくしたセルの横に出るのはロースター／フィルムストリップで、
それはユーザーが切り替えられるモードでしかない。そして「唯一のターミナルを大きくしたい」は、それ自体として
普通に欲しい操作だった（オーナー判断）。

副作用として、launcher セルしか無いグリッドでも Expand できる。launch フォームが大きくなるだけであり、
「セルによってボタンが効いたり効かなかったりする」方が悪いと判断した。

## テスト

ガードを戻すと落ちるテスト:

- `gridTabs.spec.ts` — "zooms the only occupied cell" / "ENTERS the zoom with one running cell" /
  "zooms a launch cell"
- `gridCanvasAutoExpand.spec.ts` — "enlarges even when that terminal is the only one"

自動 Expand 側は `gridCanvasAutoExpand.spec.ts`（GridView）、Expand 中のセルに描画された場合の従来動作は
`canvasAutoOpen.spec.ts`（TerminalGrid）で固定している。
