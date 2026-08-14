# fix #1496 — a killed tmux CLIENT is not a finished session

## What was reported

The phone's list lost its Claude Code terminals; reloading a desktop tab brought them back. The
server had not restarted, and tmux still held sessions. The log, at the moment of the reload:

```text
[pty] claude exited code=0 signal=9 … session A
[pty] claude exited code=0 signal=9 … session B
[ws] disconnected A / B
[ws] reattach <three others>
[ws] client connected (resume A) → [pty] started claude … resume A
```

## Why it happens

**With tmux, our pty is the tmux CLIENT, not the agent.** `[pty] claude exited … signal=9` therefore
says *something killed our client*, not *claude finished*. Two things establish that it came from
outside this app:

- `node-pty`'s `kill()` sends **SIGHUP** (`process.kill(pid, signal || 'SIGHUP')`), and `reap()`
  calls it with no argument — our own teardown can only ever log `signal=1`.
- The exit handler is what closes the socket (`sendExitAndClose`), so `[ws] disconnected` *after*
  `[pty] exited` means the socket was still attached when the pty died. An idle reap needs a
  DETACHED socket, so it cannot have been one.

And the exit handler reaps unconditionally:

```ts
entry.term.onExit(…) => { …; deps.reap(sessionId); }     // spawn-claude.ts, pty-relay.ts
```

while `reap()` does:

```ts
if (entry.tmux) tmuxKillSession(id);        // ends the tmux session that still has the agent in it
knownSessions.delete(id); deps.forgetTitle(id); lastPrompts.delete(id);
```

So when something outside kills our client, **we destroy the live session it was a client to** —
and forget its title, which is what drops it from the phone's list (a nameless, non-live row is
filtered out by design). A desktop reload then brings it back as a **new process** resumed from the
transcript, which is exactly what the reporter saw.

Nothing in any exit path asks tmux whether the session survived; `tmuxHasSession` is called only on
the three CONNECT paths.

## The fix

Ask tmux before tearing anything down. One rule, one place:

- **the tmux session is gone** → the agent really exited → reap, exactly as today.
- **the tmux session is alive** → only our client died → drop the dead pty entry and keep everything
  else. The next connection reattaches through the path that already exists (`tmuxAlive` in
  ws-routes), and the title is never forgotten, so the phone keeps listing it.
- **no live entry at all** → an explicit close already reaped it; do nothing.

Deliberately NOT in this change: respawning a client automatically. A client that keeps dying would
respawn in a loop, and the cell can already recover by reconnecting. The cell whose socket was open
still sees the session exit and shows it as ended until it reconnects — the same recovery the
reporter is already doing, minus the destruction.

## Why this cannot leak sessions

The objection to keeping a session alive is that nothing would ever clean it up. That is no longer
true as of #1467: the boot sweep ends anything unattached and idle past `sessionIdleReapDays`
(default 7). A client killed today either gets reattached, or is swept a week later.

## Files

| file | |
|---|---|
| `server/session/pty-exit.ts` (new) | the pure rule, and the wire-up both handlers call |
| `server/session/spawn-claude.ts`, `server/session/pty-relay.ts`, `server/session/spawn-shell.ts` | call it instead of `deps.reap` |

**All THREE**, which the first attempt got wrong: the fix was written for claude and the shared relay
(codex / agy / grok), and the staged repro then destroyed a session anyway — because a **launcher**
cell is spawned by `spawn-shell.ts`, which has its own exit handler. Its fourth sibling there
(`spawnCommandPty`, the Run menu) needs nothing: it is ephemeral, not tmux-backed, and never reaps.

## Tests

- the rule: tmux alive → keep; tmux gone → reap; no live entry → neither; a non-tmux pty → reap
  (nothing else could be holding it).
- the wiring: the kept path deletes the pty entry (a reconnect must reattach, not reuse a dead pty)
  and does not reap.

## Verification

Staged against a real server and real tmux, on both versions of the code — a launcher cell started
from a real browser, then its tmux CLIENT process `kill -9`ed the way the report describes:

```text
# before (main)
[pty] launcher exited code=0 signal=9 … session f0e10fe5-…
tmux session mt-f0e10fe5-… → DESTROYED

# after
[pty] launcher exited code=0 signal=9 … session eded52c9-…
[pty] eded52c9-… lost its client, but its tmux session is still running — keeping it
tmux session mt-eded52c9-… → STILL ALIVE
```

And the case that must NOT change — the program itself ending (staged by ending the tmux session,
which is what happens when the agent exits): `signal=0`, no "keeping it" line, reaped as before.
