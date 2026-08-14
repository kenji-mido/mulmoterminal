# feat #1467 — say which conversation is still running, and let the launcher stop it

## Why

#1467 reports tmux sessions piling up across server restarts, with no way to reach them: the
`POST /api/tmux/cleanup-orphans` route added in #367 has **no caller anywhere** (verified — only
its own route and spec reference it), and the boot path prunes settings/drops files without
touching tmux.

Wiring that route at boot would not answer the report. It spares every **resumable** session —
live pty, persisted grid session, or a Claude/Codex transcript on disk — and MulmoTerminal launches
claude with `--session-id <session id>`, so the transcript's filename IS the tmux session name.
Every conversation that was ever prompted therefore reads as resumable, forever.

Measured on one machine, 21 surviving sessions:

| | count | pane |
|---|---|---|
| attached (held by a terminal) | 12 | claude |
| **unattached, transcript on disk** | **5** | **claude still running**, idle 10–11 h |
| unattached, no transcript | 4 | `zsh` / `node` (launcher / run cells) |
| claude exited, session left behind | 0 | — |

So the pile-up is **live claude processes nobody is attached to** — not dead shells. `cleanup-orphans`
would reap 4 of 21, none of them the ones that accumulate. (Nothing sets `remain-on-exit`, so a
session whose command exits ends with it; the reporter's "the claude process has exited" is not what
survives.)

## What this change does

The narrow, user-controlled half: **surface the state where the user already looks, and let them
end it there.** The launch form's `or resume here` list is per directory and per agent, so it does
not reach a project you no longer open — that is the limit of this change, and the rest of #1467
(a sweep, or a whole-machine listing) stays open.

- The server already answers "is anyone holding this row" (`attached`, from one `tmux list-clients`
  per list). It does **not** answer "is a tmux session alive for it", because `list-clients` only
  reports sessions that HAVE a client — precisely the ones that are not the problem.
- So each row gains `runningKey`: the key of the session that is actually running for that
  conversation, or null. It is a **key, not the row's id** — a codex/agy conversation started from a
  grid cell runs under a key MulmoTerminal minted, and only the agent's conversation log connects
  the two (the same reason `attached` consults it).
- A row that is running and **unattached** shows `running` and a stop button. Attached rows keep
  `● open` and no button: that cell's own close button owns them, and stopping another tab's session
  from here is an accident waiting to happen (decided with the user).
- Stopping goes through the existing `POST /api/session/:id/terminate`, which kills the pty **and**
  its tmux, and already works on a session orphaned by a restart. No new endpoint.
- `window.confirm` first, like removing a dirty worktree — it kills a running claude, so the
  in-flight turn is lost. The conversation is not: the transcript stays on disk and the row can be
  resumed afterwards.

## Files

| file | change |
|---|---|
| `common/sessionRunning.ts` (new) | `runningKey`, in its OWN wire type rather than on `SessionOccupancy` next door: that one is the fact a second terminal needs before offering to open a session, and the worktree row depends on its shape — "what is running, and under which key" is the conversation list's own question |
| `server/routes/session-routes.ts` | one `tmuxListSessionIds()` per list; fill `runningKey` in the claude route and in `withAttached` |
| `src/composables/useDirLists.ts` | type + row guard |
| `src/components/CellLaunchForm.vue` | the `running` marker, the stop button, confirm, reload |

## Tests

- server: a row whose tmux survives carries its key; a row with nothing running carries null; the
  key for a codex row is the minted session key, not the conversation id.
- UI: the marker and button appear only for running + unattached; the button POSTs to
  `runningKey` (not to the row id) and reloads the list; a cancelled confirm posts nothing; an
  older server's rows (no `runningKey`) render exactly as before.

## Not in this change

- Automatic cleanup at boot or on a timer (#1467's own proposal) — it would reap the wrong 4.
- Making `isResumableTmuxSession` less conservative, which is the root cause of the accumulation.
- A whole-machine listing that reaches directories the launcher never opens.
