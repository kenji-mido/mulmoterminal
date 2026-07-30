---
title: Always-on (running the server as a service)
layout: default
parent: English
nav_order: 10.5
---

# Always-on — running the server as a service

`npx mulmoterminal` is tied to the terminal you launched it from. Close that terminal and it
stops; it doesn't survive a logout or a reboot. If you want MulmoTerminal to **just be there
whenever you open the tab**, run the server as an OS service.

This page covers **Linux (a systemd user unit)** in depth, with notes for macOS (launchd).

> Each agent session is itself a tmux session. What you're making persistent here is the
> **server process (Node)**. They're separate layers — conflating them is how you hit
> [the one real pitfall](#killmode).

---

## The shape of it

| Job | Owner |
|---|---|
| Starting, restarting and logging the Node server | systemd user unit |
| Surviving logout and reboot | `loginctl enable-linger` |
| Persisting each agent session | tmux (the app does this itself, on its own socket `-L mulmoterminal`) |
| Day-to-day control (open, logs, status) | a shell function (`mt`, below) |

Let systemd be the only supervisor. Wrapping the server in a `while true; do … done` loop
inside tmux just gives you two supervisors and a state you can't read.

---

## 1. Install the unit

`~/.config/systemd/user/mulmoterminal.service`:

```ini
[Unit]
Description=MulmoTerminal — browser terminal + GUI panel for Claude Code
After=default.target

[Service]
Type=simple
WorkingDirectory=%h/Work/mulmoterminal

# A systemd user session's PATH does not include an nvm-installed node, and the server
# shells out to claude / tmux / git / gh — so all of them have to be reachable here.
Environment=PATH=%h/.nvm/versions/node/v24.18.0/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=PORT=34567
Environment=CLAUDE_CWD=%h/Work/mulmoterminal

ExecStart=%h/.nvm/versions/node/v24.18.0/bin/node --import tsx --env-file-if-exists=%h/Work/mulmoterminal/.env server/index.ts

Restart=always
RestartSec=2

# Required on some tmux builds — see "KillMode and cgroups" below.
KillMode=process

StandardOutput=journal
StandardError=journal
SyslogIdentifier=mulmoterminal

[Install]
WantedBy=default.target
```

systemd expands `%h` to your home directory. Adjust the paths, the port and `CLAUDE_CWD` to
match your machine.

- **`CLAUDE_CWD`** — the default working directory new sessions open in (defaults to
  `~/mulmoclaude`).
- **`PORT`** — `34567` by default. If you also run `yarn dev`, give that a different port
  (e.g. `34568`) so it doesn't fight the always-on instance.

### Why not call `bin/mulmoterminal.js`

The launcher **asks interactive questions** — port already in use, looks like a second
instance, `claude` not found. Under a service there is **no stdin to answer them**, so it
hangs or dies. The unit invokes the server entry point directly, the same as the `server`
script in `package.json`.

<a id="killmode"></a>

## 2. `KillMode` and cgroups — a pitfall that depends on your tmux

The tmux server hosting the agent sessions is spawned by the MulmoTerminal process. tmux
daemonizes, so it survives its parent dying — but **normally it cannot escape the cgroup**.
Left inside the unit's control group, systemd's default `KillMode=control-group` (kill
**every process in the cgroup** on stop) means each `systemctl --user restart` **wipes all
running agent sessions**: the tmux layer that exists to survive a server restart gets killed
by the server restart.

**On most Linux distros this doesn't actually happen.** A tmux built with systemd support
(Debian/Ubuntu's package, for one — check with `ldd $(which tmux) | grep systemd`) moves the
server into its own transient **`tmux-spawn-<uuid>.scope`** every time a session is created.
tmux escapes the cgroup by itself, so the sessions survive whatever `KillMode` says.

To find out which case you're in, open a session and run:

```bash
for p in $(pgrep -x tmux); do echo "$p: $(cat /proc/$p/cgroup)"; done
```

- `…/tmux-spawn-….scope` → tmux escapes on its own; `KillMode` is not load-bearing here.
- `…/mulmoterminal.service` → it's inside the unit's cgroup, and **without
  `KillMode=process` a restart will wipe your sessions.**

`KillMode=process` kills **only the main process** (node) and leaves the rest alone. In the
first case it's simply harmless; in the second it's essential. **If you don't know which you
have, keep it** — it costs nothing. (Self-built tmux, Homebrew tmux on macOS, and musl-based
distros tend to fall in the second case.)

## 3. Enable it

```bash
systemctl --user daemon-reload
systemctl --user enable --now mulmoterminal

# Survive logout and reboot — without this it only lives while you're logged in.
loginctl enable-linger "$USER"
```

Check:

```bash
systemctl --user is-active mulmoterminal     # → active
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:34567/   # → 200
```

## 4. Add a shell helper

The unit owns the process, so the shell side is purely a **control surface** — never start a
server here, or it will race the unit for the port. In `~/.bashrc`:

```bash
mt() {
  local url="http://localhost:34567"
  case "${1:-open}" in
    open)     xdg-open "$url" >/dev/null 2>&1 & ;;   # `open` on macOS
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

`mt sessions` / `mt attach` look at the **dedicated socket `-L mulmoterminal`**. That's a
different tmux server from your everyday one — the sessions won't show up in `tmux ls`, and
the two never interfere.

## 5. Verify sessions survive a restart

This is the one thing worth actually testing. Open a session, then:

```bash
tmux -L mulmoterminal ls          # the session is listed
systemctl --user restart mulmoterminal
tmux -L mulmoterminal ls          # still there → it worked
```

If it's gone afterwards, either `KillMode=process` isn't in the unit, or you added it without
running `daemon-reload`.

---

## Several machines, one phone

If you run always-on instances on several machines and reach them from one phone by port
forwarding — **give every machine a different `PORT`, and forward same-number to
same-number (local N → remote N).**

The reason is Web Push. The completion notification carries the server's own port in its
payload (`server/session/task-push.ts`):

```js
void sendWebPush(title, body, { sessionId, hostId: REMOTE_HOST_ID, port: uiPort });
```

The URL opened when you tap the notification is built from that number. So if you forward
across numbers — `-L 34568:localhost:34567` — **the notification tells the phone to open
34567**, which on the phone is a different machine's tunnel, or nothing at all. `hostId` is
what distinguishes the machines; **the port is not rewritten**.

Keep the numbers aligned and a notification's port always points at the right tunnel. As a
bonus, the **origin seen by the phone's browser (`localhost:<port>`) differs per machine**,
so the UI state kept in `localStorage` (`session_layout` / `terminal_width` /
`tools_pane_visible`) doesn't bleed between them either.

| Machine | `PORT` in the unit | Forward on the phone |
|---|---|---|
| machine-a | 34570 | 34570 → 34570 |
| machine-b | 34571 | 34571 → 34571 |
| machine-c | 34572 | 34572 → 34572 |

Leave `34567` (the `npx mulmoterminal` default) and whatever `yarn dev` uses **free**, so
ad-hoc launches never collide with the always-on instance.

To change the port:

```bash
systemctl --user edit --full mulmoterminal   # edit Environment=PORT=
systemctl --user restart mulmoterminal
```

Update the `url` inside the `mt` function to match.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Fails with `status=203/EXEC` | `ExecStart` isn't an absolute path to node — systemd doesn't inherit your shell's PATH |
| Starts, but sessions won't spawn | `claude` / `tmux` / `git` / `gh` missing from `Environment=PATH` |
| Sessions die on every restart | No `KillMode=process` ([above](#killmode)) |
| Dies at logout | `loginctl enable-linger "$USER"` not done |
| Broke after a node upgrade | The nvm version is hard-coded in `ExecStart` / `PATH` — update the unit too |
| Port conflict | Another instance (e.g. `yarn dev`) on the same `PORT` |

Logs: `journalctl --user -u mulmoterminal -e` (`-f` to follow).

## Security

The server **listens on all interfaces**, not just `localhost`. Running it always-on means
that port is always open. On a laptop that joins shared or public networks, firewall off
34567 or restrict it to networks you trust.

## macOS (launchd)

Same idea: drop a `~/Library/LaunchAgents/com.mulmoterminal.plist` and `launchctl load -w`
it. launchd has no cgroup-wide kill, so there's no `KillMode` equivalent to worry about — but
**the PATH problem is identical** (spell out the nvm node and `claude` paths in
`EnvironmentVariables`).

---

- For launching in general see [the basics](basics.html); for ports and env vars see
  [configuration](config.html).
- Pair this with [mobile notifications](notifications.html) — always-on plus Web Push means a
  finished task reaches you even with the browser closed.
