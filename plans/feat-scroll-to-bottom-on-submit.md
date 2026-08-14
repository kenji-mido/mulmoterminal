# スクロール中に Enter を押したら最新位置に戻す

issue: #1546

## 症状

Claude Code のセルでスクロールした状態で Enter を押しても最下部に戻らない。普通のターミナルは戻る
（xterm の `scrollKey`、xterm.js の `scrollOnUserInput`）。**シェル（zsh）のセルでは戻る。**

## 原因（実機の tmux から確定）

`tmux -L mulmoterminal list-panes -a` の実測:

| pane | `mouse_all_flag` | `alternate_on` | ホイールの行き先 | Enter |
|---|---|---|---|---|
| Claude Code (`2.1.22x`) | **1** | **1** | tmux が**アプリに転送** | Claude Code が受け取るが戻さない |
| zsh | 0 | 0 | tmux **copy-mode** | `copy-selection-and-cancel` で最下部へ |

Claude Code は**マウス追跡 1003 を有効化し、かつ代替バッファ**。**スクロール位置を持っているのは
Claude Code 自身**であって、こちら側に戻すべきものが無い。

- `term.scrollToBottom()` は no-op — 代替バッファに xterm のスクロールバックは無い
- `scrollOnUserInput`（既定 true、未上書き）も無関係 — 戻すビューポートが無い
- 「Claude セルもホイールを tmux copy-mode に回す」は**不可** — 代替バッファのペインには tmux 側の
  履歴が無く、copy-mode に入っても上が空になる
- Claude Code は**普通のターミナルでも戻らない**（報告者が iTerm で確認）ので上流の挙動

## 直し方

ホイールレポートを**合成しているのはこのアプリ自身**（#737 / #845 の再合成、`terminalMouseInput.ts`
の `report()` が唯一の合成点）。したがって「アプリを何ノッチ分スクロールさせたか」を知っている。

- `guardMouseWheel` が **`depthNotches`**（最下部からの距離、ノッチ数）を持つ。上向きで増、下向きで
  減、**0 でクランプ**（アプリは自分の底で止まるので、それ以上のレポートは何も動かさない。負に
  させると後の復帰が「ユーザーの実際の位置より下」へスクロールしてしまう）。
- `WheelScrollControl.restoreToBottom()` がその分だけ下向きレポートを送る。
- **送信時**に呼ぶ。スクロールしていなければ 1 バイトも送らない。

### 一度に送らずフレームごとに分けて払う（実機テストで判明）

最初の実装は債務を 1 tick で全部送っていた。実機では**反応はするが 1〜2 ページ分しか戻らない**。

本物のジェスチャは小さなデルタが数百 ms に分散して届くのに対し、こちらは同期ループで一気に送るため
**TUI 側が 1 回の pty read として受け取り、まとめてしまう**。戻る量が `MAX_NOTCHES_PER_EVENT`（= 24、
ちょうど 1 画面分）の 1〜2 個分だったことと一致する。

`RESTORE_NOTCHES_PER_FRAME`（= 4）ずつフレームに分けて払う。アプリから見ればジェスチャらしい形に
なり、最後まで戻る。ユーザーが自分でスクロールし直したら支払いは中断する（両者が競って画面が
ぶれるため）。フレームスケジューラは注入可能にしてテストから駆動する。

### 送信の判定

`enterSubmits(e)` を `common/terminalSubmit.ts` に追加。**モード非依存** — 2 つのモードが違うのは
「どのバイトがどの意味を運ぶか」だけで、意味そのもの（素の Enter = 送信、Shift/Alt+Enter = 改行）は
同じ。

`enterKeyOverride` とは別関数にする必要がある: `"cr"` モードの素の Enter は xterm がネイティブ処理し
override は `null` を返すので、その戻り値を「送信ではない」と読むと**最も普通の送信を取りこぼす**。

呼ぶのは 2 箇所:
- キーハンドラ（バイトを送る**前**。送信が着弾した時点でアプリが最下部にいるように）
- `submitText()`（GUI の送信ボタン。スクロール中に押すと回答が見えない場所に書かれてしまう）

### 設定

既存の `terminalScrollSpeed` と同じ形（ブラウザごとの localStorage + `TerminalScrollSection.vue`）。
**既定 on** — 普通のターミナルの挙動に合わせる。off はターン実行中に読みながら留まりたい人向け。

`"0"` のときだけ off。未設定・壊れた値・将来のバージョンが書いた値は既定へフォールバックする
（黙って機能が消えるより良い）。

## 構造

`terminalMouseInput.ts` の `guardMouseWheel` が行数上限を超えたので、2 つの小さな機械に分けた。
どちらも「1 つの規則を 1 箇所に置く」ためで、行数合わせのためだけの分割ではない。

- `createScrollDebt` — 債務の記録・分割払い・中断・破棄
- `createGestureFlush` — ジェスチャ終端のフラッシュタイマー

## 副次的な変更

`useTerminalConnections.ts` が 600 行の lint 上限を超えたので、`makeEnterHandler` /
`makeSendHandler` を `terminalKeyHandlers.ts` へ切り出した（接続に依存しない純粋な部分で、
mode getter / keymap getter / send 関数しか要らない）。

## テスト

`terminalMouseInput.spec.ts` の**本物の xterm を使うハーネス**に追加（この spec の既存方針。
「ルールだけ検証しても、リスナが違う要素・違うゲートに付いていれば同じように通ってしまう」）。

- スクロールしていなければ何も送らない
- 上げた分だけ正確に巻き戻す
- 自分で下げた分は差し引く
- 下げ過ぎても**クレジットにならない**
- 一度払ったら二度目は何も送らない
- アプリがマウスを取らなくなったら**払わずに忘れる**
- **アプリ A 終了 → アプリ B 起動の間に何も起きなくても、A の債務が B に払い込まれない**
  （#1547 の Codex レビュー。債務の破棄を「次の wheel イベント/restore のとき」ではなく
  **遷移そのもの**＝`buffer.onBufferChange` で行う。修正前は 6 個の下向きレポートが B に流れることを
  実際に確認した）

注意: テストのデルタは**ホイール相当（120px 単位）に揃える**。小さいデルタはトラックパッド扱いで
gain がかかるため、1/3 のデルタが 1/3 のノッチにならない。

`enterSubmits` は `test/common/terminalSubmit.spec.ts`。

## 検証

`yarn format` / `yarn lint`（0 errors）/ `yarn typecheck` / `yarn build` / `yarn test`

## 対象外

- シェルのセル（tmux copy-mode が既に正しく処理している）
- 既存の #737 / #845 の挙動（一切変えていない）
