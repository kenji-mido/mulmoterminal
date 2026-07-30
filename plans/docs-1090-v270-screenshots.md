# docs: 2.7.0 ガイドにスクリーンショットを追加する (#1090)

2.7.0 のガイド (`docs/guide/{en,ja}/v2.7.0.md`) は文章だけで出したので、画像を後から足す。

| 画像 | 写すもの |
|---|---|
| `v2.7.0-session-memo.png` | メモがあるセルヘッダと、無いセルヘッダが並んでいる状態 (#1084) |
| `v2.7.0-zoom-splitter.png` | 拡大したセルの境界をドラッグしているところ (#1077) |

## 着手前に潰した 2 つの誤診

**1. 「zsh ランチャーのセルに鉛筆が出ないのは `sessionId` が立っていないから」ではない。**
issue はそう推測していたが、原因は別。grid のセルは `cell.launcher` があれば
`LauncherCell.vue` として描画され (`TerminalGrid.vue`)、そのコンポーネントには**メモの UI が
そもそも存在しない** — `cell-memo-edit` は `TerminalCell.vue` にしかない。ランチャー
(Shell / 設定した `zsh`) を選ぶと必ず `LauncherCell` になるので、鉛筆は原理的に出ない。

**2. 「撮影用に Claude の認証が要る」わけでもない。**
`handleClaudeConnection` は spawn の**前**に `type: "session"` を送る (`ws-routes.ts`)。なので
scratch `HOME` で claude が未ログインでも `sessionId` は立ち、鉛筆は出る。実測して 2 本出た。
メモを付けて reload しても残ることまで確認した (ホスト側保存の裏取り)。

結論: メモの撮影には **claude / codex のセル**が要る (ランチャーでは不可)。認証は要らない。
ただし本文には未ログイン画面が出るので、**ヘッダ帯だけを切り出す**。これは
`v2.5.0-work-item-chip.png` (830x70) / `v2.5.0-rate-limit-gauge.png` (700x40) と同じ既存の作法。

## 撮影環境

- scratch `HOME` に `.mulmoterminal/config.json` (`cwdPresets`, `launchers`) と `.zshrc` を置き、
  `HOME=<scratch> PORT=34590` でサーバを起動。実 config は触らない。
- 出したディレクトリは `~/work/{api-gateway,billing,website}` — 撮影用に作ったもので、
  実ディレクトリは 1 つも写っていない。
- 実サーバの tmux セッションは触らない。作った分だけ `server*.log` の id から kill。

### 踏んだ罠

- **`cwdPresets` の `~/...` は効かない。** `existingWorkspace` は `path.isAbsolute` で弾くので、
  `~/work/api-gateway` は無言でデフォルト workspace (`~/mulmoclaude`) に落ちる。UI のヘッダは
  入力した方を表示するので、**画面とサーバの spawn 先が食い違ったまま気付かない**。
  絶対パスで書く。裏取りは `tmux capture-pane` と `[pty] started` のログ。
- **プロンプトは `.zshrc` だけでは決まらない。** tmux のペインは
  **tmux サーバの環境**を継承する (`tmux.ts` の `tmuxNewSessionArgs` のコメントがそう書いている)。
  ソケット名 `SERVER_SOCKET = "mulmoterminal"` は固定で env の seam が無いため、実サーバが
  立てた tmux サーバの `HOME` が入り、実 `.zshrc` が読まれて実プロンプトが出る。
  ランチャーのコマンド側で `env HOME=<scratch> ZDOTDIR=<scratch> zsh` と明示して解決。
- **`deviceScaleFactor: 2` はターミナルを含む画では使えない。** xterm の canvas は backing store を
  CSS サイズのまま保つ (実測: dsf=2 でも `canvas.width == canvas.clientWidth`)。2x で撮ると
  ターミナルの字だけ 2 倍に伸びる。`deviceScaleFactor: 1` で撮ると 14px の既存画像と一致する。
  CLAUDE.md の「deviceScaleFactor: 2, then downscale」は、ターミナルが写る画では**このとおりには
  ならない**。

## 検証

- 境界: `getComputedStyle(el).cursor === "col-resize"` を DOM で確認し、ドラッグで
  `aria-valuenow` が 360 → 470 に動くことをアサート (推測した座標ではなく実測)。
- メモ: `cell-prompt` が `["do not interrupt - release build", "61263732"]`、reload 後も同じ。
- 画像参照が実ファイルに解決すること、ページ内リンクが実ページに解決することを確認。
