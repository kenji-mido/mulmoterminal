# feat: スマホのターミナル画面をスクロールバック300行まで広げる（#1272）

## いま

`getTerminalScreen` が返す `screen` は「見えているペイン1画面分」だけ。

- tmux 経路: `tmuxCaptureStyledPane` が `capture-pane -p -e`（`-S` なし = 可視ペインのみ）
- フォールバック経路: `renderScreen` が `active.getLine(active.baseY + row)` を `rows` 本だけ読む

スマホの狭い画面ではこれだと足りず、直前の出力を追えない。

## 変更

`SCREEN_HISTORY_ROWS = 300` を `server/backends/remoteHost/terminalScreen.ts` に置き、3箇所で使う。

1. **tmux 経路** — `tmuxCaptureStyledPane(id, historyLines)` にして `-S -<historyLines>` を渡す。
   tmux の `history-limit` は既に 20000（`server/infra/tmux.ts:88`）なので履歴は溜まっている。
   実機で確認済み: `capture-pane -p -e` は10行（= pane rows）、`-S -300` は121行を返した。

2. **フォールバック経路** — `renderScreen` に `historyLines` を足し、`baseY - historyLines` から
   `baseY + rows` までを読む。emulator の `scrollback` も同じ値で明示する（xterm の既定 1000 に
   暗黙に依存させない）。入力 `buffer` は既に 1 MiB の bounded tail（`OUTPUT_BUFFER_LIMIT`）。

3. **切り揃え** — `captureSessionScreen` で末尾 `SCREEN_HISTORY_ROWS` 行に揃える。
   2経路が別々に窓を決めると tmux の有無で見え方が変わるので、窓の規則は1箇所に置く。

## 窓の規則（`screenWindow`）

1. 末尾の空行を落とす — 可視ペインの余白であって内容ではない。先に落とさないと
   「300行 − ペインの空き」しか残らない。`rowsToScreen(...).trimEnd()` が最終的に消すので
   表示上の差はない。
2. 末尾300行を取る。
3. バイト上限（256 KiB）まで、**新しい行から**詰める。溢れたらそこで打ち切り（間を飛ばして
   古い小さい行を拾うと窓が不連続になる）。

バイト上限を入れる理由: `terminalScreen.ts` 冒頭の「screen は rows×cols で有界だから 1MiB の
command-doc 上限に対して paging 不要」という前提が、履歴を含めた時点で崩れるため。
300行 × 200桁の日本語 ≒ 180 KB なので、通常の使い方では上限に触れない。触るのは
4K モニタ級の極端に広いペインだけ。

## 計測: どのセッションに効くのか（実測）

**Claude セッションには効かない。** このマシンの実セッション41本を調べた結果:

```text
15本  alt=1 hist=0  cmd=2.1.220 (Claude Code)
 3本  alt=0 hist=0  cmd=2.1.220
13本  alt=0 hist=0  cmd=zsh
 数本  alt=0 hist=3〜82  cmd=zsh
```

Claude Code は alternate screen で動く。tmux の alt screen にはスクロールバックが無く
（`history_size=0`）、`capture-pane -a -S -` で退避された通常画面を取っても空行しか返らない。

さらに、PTY のバイト列を再生しても出てこない。自分のセッションを 0.4 秒間隔で40フレーム
キャプチャし、フレーム N+1 が N を上へずらしたものかを判定した結果:

```text
framesChanged: 39 / scrollTransitions: 0 / repaintTransitions: 39 / rowsScrolledOffTotal: 0
```

39回の変化すべてがその場の描き直しで、スクロールはゼロ行。見えなくなった行は
「ビューポートより上の行」としてどこにも存在したことがない。
`useTerminalConnections.ts` の #782 の注記（"tmux owning the scrollback — the outer xterm
only ever receives the visible screen"）とも一致する。

したがって、この変更が効くのは**スクロールバックが実際に溜まるペイン**だけ
（実測でシェルセッションの 3〜82 行）。Claude セッションの過去ログは transcript
（`sessionLastTurn` / `sessionTimeline`）にしか無い — 別 issue。

## 影響しない（確認済み）

- `suggestionFromRows` は `findLastIndex(offersSuggestion)`（`screen-rows.ts:119`）。
  スクロールバック中の古いゴーストは拾わない。
- スマホ側の `parseChoices` も最後の連続 1..N ブロックだけを取る。

## テスト

- `terminalScreen.spec.ts` — `screenWindow`: 末尾空行の除去、300行への切り揃え、
  バイト上限での打ち切り、上限以下ならそのまま。
- `headlessScreen.spec.ts` — `historyLines` 分のスクロールバックが返ること、
  履歴が足りないセッションでも落ちないこと。

## スマホ側

`<pre>` の高さ制限と下端追従は mulmoserver#139。
