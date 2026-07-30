# fix #957: a tmux window that fell out of step with its client never recovers

## Symptom

The terminal shows content in the top-left corner and blank everywhere else — the right
columns and the bottom rows are empty, and the agent's input box is gone. Reported as
"リサイズ/リロード後にターミナルが真っ白になる" (#957); the field report that led here added
the part the issue did not have: **a page reload does not fix it.** Typing still reaches the
program.

Measured off the reporter's screenshot: the content wraps at ~77 columns inside a terminal
that is ~136 columns wide. So this is not a missing repaint of a correct buffer — the cells
to the right and below were never written, because **tmux's window really is that small.**

## Root cause

tmux learns a client's size from `SIGWINCH`, and the kernel raises `SIGWINCH` only when the
size actually **changes**. Every repair path we have re-sends the size the pty already holds,
which is silent:

- `Terminal.vue`'s `ResizeObserver` → `fitAndSyncSize` → `{type:"resize"}` → `term.resize()`
- a reload re-attaches and sends the same size again from `sock.onopen`
- `tmuxRedrawClient` (#1073) asks tmux to repaint — which it does, faithfully, at the size it
  still believes in

So once the window and the client disagree, nothing in the product closes the gap. Only a
real size change does, which is why resizing the browser window by hand is the known
workaround.

### Measured (tmux 3.6a, isolated `-L mtprobe` server, two clients on one session)

A live disagreement — our client is 120x40, the window is 80x24:

| attempted repair | window after |
|---|---|
| re-send the size the pty already has (what a reload does) | 80x24 — unchanged |
| `refresh-client -t <our tty>` (the #1073 fix) | 80x24 — unchanged |
| resize the pty to 120x39, then back to 120x40 | **120x40 — repaired** |

Also measured, and the reason `resize-window` is not the repair: it switches that window's
`window-size` to `manual`, after which the window stops following the client for good.

### Where the gap comes from

Not established. Two mechanisms are known to produce it, and the fix repairs both:

- a second client on the same tmux session (another mulmoterminal server holding it, the
  overlap window during a `yarn` restart) — `window-size latest` sizes the window to that
  client, and the measured probe reproduces the exact symptom while it is attached
- a `SIGWINCH` that never lands (delivered while our tmux client is still starting up)

The reporter's triggers — page reload, `yarn` restart, hot reload — are all paths that
re-attach or re-spawn the pty, which is where both mechanisms live.

## The fix

Detect the disagreement and close it with a size change tmux cannot miss.

1. `server/infra/tmux.ts` — ask tmux for `#{window_width}x#{window_height}`
   (`tmuxWindowSize`, async so a settled browser resize across ten grid cells does not block
   the event loop ten times), plus a pure parser for the test.
2. `server/session/tmux-size-sync.ts` (new) — after a resize burst settles, compare tmux's
   window against the size the client asked for. On a disagreement, shrink the pty by one row
   and put it straight back, then re-check and warn if it did not take.
3. `server/session/pty-connection.ts` — call it from the resize branch (tmux sessions only),
   and cancel a pending check when the socket goes away.
4. `server/index.ts` — wire the deps to `ptys` and `tmuxWindowSize`.
5. `server/infra/tmux.ts` — set `status off` in `applyLiveTmuxOptions` too. It is already in
   `CONF_FILE` for looks, but the comparison now DEPENDS on it: a status line reserves a row, so
   `window_height` would sit one below the client's forever and every resize would read as a
   disagreement. A tmux server that predates the conf keeps its status bar across node restarts.
   Measured: with the status line on, `client=80x24` against `window=80x23`; `set -g status off`
   on the running server closed it.

Debounced, so a splitter drag or a window resize costs one probe, not one per frame. A size
tmux cannot report is never treated as a disagreement — an unreadable answer must not nudge.

### A started check has to be abandonable (Codex, #1116 review)

A check is several awaits long, so `cancel` clearing a timer cannot reach one that is already
running. Left alone, a nudge that started for 120x40 would call `resizePty(120, 40)` *after* the
client had moved to 137x41 — putting the pty back behind the browser, which is the same
disagreement in the other direction.

So every request takes a monotonic ticket, and each step past an await asks whether it still holds
the newest. Two details that a weaker version would get wrong:

- **The restore targets the NEWEST size, not the captured one.** A superseded nudge still finishes
  its second resize, because leaving the pty a row short is worse than finishing — and the size it
  finishes on has to be the one the client actually has.
- **A ticket is never handed out twice.** The counter is per-process, not per-session, so freeing a
  session's entry cannot let a resumed id reissue a number an in-flight check still holds — the
  check simply fails the guard, which is the right answer.

### The bookkeeping has to be freed (Codex, #1116 review, second pass)

`handleClientClose` cancels for EVERY session, tmux or not, so a `cancel` that allocated would leak
an entry per disconnect for the server's whole life. `cancel` now touches nothing for an id it has
not seen, and `reap` calls `forget` — a socket close only pauses the bookkeeping, because a
detached session can reattach; teardown is the one place that frees it.

`trackedSessionCount()` exists so this is testable rather than asserted in a comment.

### One guard is not enough (Codex, #1116 review, third pass)

Two more awaits separate the ownership check in `nudge` from the `still-wrong` report, so a resize
landing in that gap produced a warning naming a size the client had already left. Nothing is
mutated on that path — but `still-wrong` is the signal that *the repair itself failed*, and a false
one sends the next investigator after a mechanism that isn't there, which is the opposite of what
the logging is for.

The invariant is now written down in the code: **every step after an `await` either re-checks the
ticket or is correct for any ticket.** There is exactly one of the latter (the restore, which reads
the newest size rather than the captured one) and it is marked as such, so a future reader doesn't
"fix" it by adding a guard that would leave the pty a row short.

### A gap the nudge cannot close must not be retried forever

Found by measurement during review, not by any bot. Spawning eight sessions against a real tmux and
running the real check produced one where the window sat at 137x40 against a 137x41 client: that
server's status line was still on, and a reserved row means the two can **never** be equal. The
nudge fired, failed, and — before this — would have fired again on every subsequent resize, for the
session's whole life: a pointless double-resize of the app each time, and the same warning repeated
until it drowned the signal the logging exists to give.

So an identical `(client, window)` pair is reported once and then left alone. Any change to either
size makes it news again, and so does the window catching up in between. Verified against real
tmux: resizes 2-4 of an unclosable gap produced nothing, and a different client size was tried.

This is also why `status off` had to move into `applyLiveTmuxOptions` — that measurement is what a
server predating the conf actually does.

## Why this is also the detector

The repair logs (`console.warn`) with the two sizes. #957 has been stuck because the bug is
rare and leaves no trace: this makes every occurrence attributable, and a repair that fires
and does NOT close the gap says the mechanism is a third one we have not found.

## Tests

`test/server/session/tmux-size-sync.spec.ts` and the parser case in the tmux spec:

- agreeing sizes → no nudge
- disagreeing sizes → nudge to `rows - 1`, then back to `rows`
- tmux cannot answer (null) → no nudge
- a one-row terminal nudges UP (`rows + 1`), since it cannot shrink
- several resize frames in a burst → one probe
- cancelled before it settles → no probe
- the re-check warns when the window still disagrees after the nudge
- a check superseded mid-probe touches nothing
- a resize arriving mid-nudge → the restore lands on the NEW size
- a superseded nudge leaves the verification to the newer check
- `cancel` mid-nudge → abandoned, but the pty still ends at the client's size
- a cancel followed by a new request cannot revive the abandoned check
- `parseTmuxWindowSize`: `"120x40"`, junk, empty
- `TMUX_CONF_LINES` turns the status line off — the comparison's precondition

## Not done

Not reproduced end-to-end in the product, because the symptom cleared before the cause was
pinned down. What is measured is that the disagreement produces exactly this screen and that
the nudge is the only repair of the three that works.
