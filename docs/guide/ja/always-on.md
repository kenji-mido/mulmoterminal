---
title: 常時起動（サーバを常駐させる）
layout: default
parent: 日本語
nav_order: 10.5
---

# 常時起動 — サーバを常駐させる

`npx mulmoterminal` は起動したターミナルに紐づきます。ターミナルを閉じれば止まり、ログアウトや
再起動をまたぎません。**ブラウザのタブを開けばいつでもそこにいる**状態にしたいなら、サーバを
OS のサービスとして常駐させます。

このページは **Linux（systemd user unit）** を軸に、macOS（launchd）も補足します。

> エージェントの各セッションは、それ自体が tmux セッションです。ここでやるのは
> **サーバ本体（Node プロセス）** を常駐させること。両者は別レイヤーで、混同すると
> [後述の落とし穴](#killmode)を踏みます。

---

## 全体像

| 役割 | 担当 |
|---|---|
| サーバ（Node）の起動・再起動・ログ | systemd user unit |
| 再起動・ログアウトをまたぐ | `loginctl enable-linger` |
| エージェントの各セッションの永続化 | tmux（アプリが自分でやる。専用ソケット `-L mulmoterminal`） |
| 日常操作（開く・ログ・状態） | シェル関数（後述の `mt`） |

プロセスの監督は systemd に一本化します。`while true; do … done` のような自前の再起動ループを
tmux の中に置くと、監督者が二重になって状態が読めなくなるだけです。

---

## 1. unit ファイルを置く

`~/.config/systemd/user/mulmoterminal.service`：

```ini
[Unit]
Description=MulmoTerminal — browser terminal + GUI panel for Claude Code
After=default.target

[Service]
Type=simple
WorkingDirectory=%h/Work/mulmoterminal

# systemd の user セッションの PATH には nvm の node は入っていない。
# サーバは claude / tmux / git / gh を外部コマンドとして呼ぶので、全部届く PATH にする。
Environment=PATH=%h/.nvm/versions/node/v24.18.0/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=PORT=34567
Environment=CLAUDE_CWD=%h/Work/mulmoterminal

ExecStart=%h/.nvm/versions/node/v24.18.0/bin/node --import tsx --env-file-if-exists=%h/Work/mulmoterminal/.env server/index.ts

Restart=always
RestartSec=2

# tmux ビルドによっては必須。理由は下の「KillMode と cgroup」を参照
KillMode=process

StandardOutput=journal
StandardError=journal
SyslogIdentifier=mulmoterminal

[Install]
WantedBy=default.target
```

`%h` は systemd がホームディレクトリに展開します。パス・ポート・`CLAUDE_CWD` は環境に合わせて
書き換えてください。

- **`CLAUDE_CWD`** — 新しいセッションが開くデフォルトの作業ディレクトリ（未設定なら `~/mulmoclaude`）。
- **`PORT`** — 既定 `34567`。開発用に `yarn dev` を併用するなら、そちらを別ポート（例 `34568`）にして
  常駐インスタンスとぶつけないこと。

### なぜ `bin/mulmoterminal.js` を呼ばないのか

ランチャは**対話的に質問します**——ポートが埋まっている、二重起動らしい、`claude` が見つからない、
など。サービスとして動かすと**答える stdin がなく**、そこで固まるか即死します。unit からは
`package.json` の `server` スクリプトと同じ、サーバのエントリを直接叩きます。

<a id="killmode"></a>

## 2. `KillMode` と cgroup — 環境しだいの落とし穴

エージェントのセッションを載せている tmux サーバは、MulmoTerminal のプロセスから spawn されます。
tmux サーバは daemonize するので親プロセスの死は生き延びますが、**普通は cgroup からは逃げられません**。
unit の cgroup に居座ったままだと、systemd の既定 `KillMode=control-group`——停止時に
**cgroup 内の全プロセス**を殺す——が効いて、`systemctl --user restart` のたびに走行中のエージェントが
全滅します。サーバ再起動を生き延びるための tmux が、サーバ再起動で死ぬ、という逆転です。

**ただし、多くの Linux ディストロではこれは起きません。** systemd サポート付きでビルドされた tmux
（Debian / Ubuntu のパッケージ版など。`ldd $(which tmux) | grep systemd` で確認できる）は、新しい
セッションを作るたびにサーバを **`tmux-spawn-<uuid>.scope` という独立した transient scope へ移します**。
つまり tmux 自身が cgroup から抜け出すので、`KillMode` が何であっても生き残ります。

自分の環境がどちらかは、セッションを 1 つ開いた状態でこう確かめられます：

```bash
for p in $(pgrep -x tmux); do echo "$p: $(cat /proc/$p/cgroup)"; done
```

- `…/tmux-spawn-….scope` → tmux が自力で逃げている。`KillMode` は効きません（気にしなくてよい）
- `…/mulmoterminal.service` → unit の cgroup の中。**`KillMode=process` が無いと再起動で全滅します**

`KillMode=process` は**メインプロセス（node）だけ**を落として残りを放置します。前者の環境では単に
無害、後者では必須。**どちらか分からないなら付けておく**のが安全側で、コストもありません。
（tmux を自前ビルドした場合、Homebrew の macOS 版、musl 系ディストロなどは後者になりがちです。）

## 3. 有効化する

```bash
systemctl --user daemon-reload
systemctl --user enable --now mulmoterminal

# ログアウトしても・再起動しても上がるように（これを忘れるとログイン中しか生きない）
loginctl enable-linger "$USER"
```

確認：

```bash
systemctl --user is-active mulmoterminal     # → active
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:34567/   # → 200
```

## 4. シェル関数を足す

unit がプロセスの持ち主なので、シェル側は**操作の窓口**に徹します。ここでサーバを直接起動しては
いけません（unit とポートを取り合います）。`~/.bashrc` に：

```bash
mt() {
  local url="http://localhost:34567"
  case "${1:-open}" in
    open)     xdg-open "$url" >/dev/null 2>&1 & ;;   # macOS は open
    start)    systemctl --user start   mulmoterminal ;;
    stop)     systemctl --user stop    mulmoterminal ;;
    restart)  systemctl --user restart mulmoterminal ;;
    status)   systemctl --user status  mulmoterminal --no-pager ;;
    logs|log) journalctl --user -u mulmoterminal -f ;;
    sessions) tmux -L mulmoterminal ls ;;
    attach)   shift; tmux -L mulmoterminal attach -t "${1:?usage: mt attach <session>}" ;;
    *) echo "usage: mt [open|start|stop|restart|status|logs|sessions|attach <s>]" ;;
  esac
}
```

`mt sessions` / `mt attach` が見ているのは**専用ソケット `-L mulmoterminal`** です。あなたが普段使う
tmux とは別サーバなので、`tmux ls` には出ませんし、互いに干渉しません。

## 5. セッションが再起動を生き延びるか確かめる

常駐化でいちばん確かめる価値があるのはここです。セッションを 1 つ開いてから：

```bash
tmux -L mulmoterminal ls          # セッションが見える
systemctl --user restart mulmoterminal
tmux -L mulmoterminal ls          # ← 同じセッションがまだ居れば成功
```

再起動後に消えているなら、`KillMode=process` が unit に無いか、書いたあと `daemon-reload` を
していないかのどちらかです。

---

## 複数マシンを 1 台のスマホから使う

複数のマシンで常駐させ、スマホから port forward で切り替えて使う場合——
**マシンごとに違う `PORT` を割り当て、転送は同じ番号どうし（local N → remote N）にしてください。**

理由は Web Push です。完了通知のペイロードには、サーバ自身のポートが埋め込まれます
（`server/session/task-push.ts`）：

```js
void sendWebPush(title, body, { sessionId, hostId: REMOTE_HOST_ID, port: uiPort });
```

通知をタップして開く URL はこの番号から組み立てられます。つまり `-L 34568:localhost:34567` のように
**番号をずらして転送すると、通知が「34567 を開け」と言ってくる**——スマホ上ではそれは別マシンの
トンネルか、何も無いポートです。マシンの区別は `hostId` が担っていて、**ポートは補正されません**。

番号を揃えておけば、通知のポートがそのまま正しいトンネルを指します。加えて、スマホのブラウザから
見た **origin (`localhost:<port>`) がマシンごとに分かれる**ので、`localStorage` に入る UI 状態
（`session_layout` / `terminal_width` / `tools_pane_visible`）も互いに混ざりません。

| マシン | unit の `PORT` | スマホ側の転送 |
|---|---|---|
| machine-a | 34570 | 34570 → 34570 |
| machine-b | 34571 | 34571 → 34571 |
| machine-c | 34572 | 34572 → 34572 |

`34567`（`npx mulmoterminal` の既定）と、`yarn dev` に使う番号は**空けておく**と、アドホック起動が
常駐とぶつかりません。

ポートを変えるとき：

```bash
systemctl --user edit --full mulmoterminal   # Environment=PORT= を書き換える
systemctl --user restart mulmoterminal
```

`mt` 関数の中の `url` も合わせて直してください。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `status=203/EXEC` で起動しない | `ExecStart` の node が絶対パスでない。systemd は PATH をシェルから受け継がない |
| 起動はするがセッションが作れない | `claude` / `tmux` / `git` / `gh` が `Environment=PATH` に無い |
| 再起動のたびにセッションが消える | `KillMode=process` が無い（[上記](#killmode)） |
| ログアウトで落ちる | `loginctl enable-linger "$USER"` を忘れている |
| node を上げたら死んだ | `ExecStart` / `PATH` の nvm バージョンが固定パス。上げたら unit も書き換える |
| ポート衝突 | `yarn dev` など別インスタンスと `PORT` が同じ |

ログは `journalctl --user -u mulmoterminal -e`（`-f` で追尾）。

## セキュリティ

サーバは**全インターフェースで listen します**（`localhost` 限定ではありません）。常駐させると
その口が常に開きっぱなしになります。共有ネットワークやカフェの Wi-Fi に載る端末なら、
ファイアウォールで 34567 を塞ぐか、信頼できるネットワークだけに限定してください。

## macOS（launchd）

同じ考え方で `~/Library/LaunchAgents/com.mulmoterminal.plist` を置き、
`launchctl load -w` します。launchd には cgroup 一括 kill が無いので `KillMode` 相当の心配は不要ですが、
**PATH の問題は同じ**です（`EnvironmentVariables` に nvm の node と `claude` のパスを明示）。

---

- 起動全般は [基本編](basics.html)、ポートや環境変数は [設定](config.html) を参照。
- 席を外しても呼び戻されたいなら [スマホ通知（Web Push）](notifications.html)。常駐と組み合わせると、
  ブラウザを閉じていてもタスク完了が届きます。
