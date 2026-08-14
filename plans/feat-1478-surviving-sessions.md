# feat #1478 — the sessions that outlived the server, in one list you can act on

## Why

A tmux session survives a server restart — that is the persistence feature — but nothing in the app
shows one you are not currently looking at, and nothing ends it. #1474 gave the launcher's
`or resume here` rows a `● running` marker and a stop button; that list is **per directory and per
agent**, so it reaches neither a project you no longer open (where #1467's reporter's sessions are)
nor a Shell / launcher session (which has no conversation to list at all).

Measured on one machine: **22 tmux sessions, 7 attached, 15 held by nobody.** The boot log says
`13 session(s) survived` and nothing else — no breakdown, no screen.

Automatic cleanup is deliberately NOT this change. `cleanup-orphans` at boot would reap **2 of the
22**: "resumable" is `live pty ∨ grid log ∨ claude transcript ∨ codex rollout`, and two of those are
permanent records — the transcript is never deleted, and `dev-terminal-sessions.json` is append-only
(439 entries here). Rethinking that predicate is #1467's own question; seeing and clearing by hand
is what makes it a calm decision instead of an urgent one.

## What ships

**Settings → a section listing every surviving tmux session, across all directories**, each row
carrying what it takes to decide:

| column | from |
|---|---|
| working directory | the live pty's own cwd, else `sessionCwd(id)` (#1021's remembered cwd) |
| what it is | the live pty's agent; else claude (transcript on disk) / codex (rollout) / unknown — which is what a Shell remnant looks like |
| idle for | tmux `#{session_activity}` |
| held by a terminal | `attached`, the same fact the launcher rows use |
| can be resumed | `resumableSessionPredicate` — so "ending this loses the conversation" is visible before the click |
| **stop** | only when **not attached** (#1474's rule: an attached row belongs to the terminal that has it) |

Ending goes through the existing `POST /api/session/:id/terminate` — no new endpoint — and reuses
`useSessionStop` from #1474, confirmation and all.

Sorted **unattached first, longest idle first**: the list's job is clearing, so what can be cleared
and has been sitting longest comes to the top. Attached rows sink to the bottom as context.

## Files

| file | |
|---|---|
| `common/survivingSessions.ts` (new) | the row type, shared by the route and the section |
| `server/infra/tmux.ts` | `tmuxSessionActivity()` — one `list-sessions -F` for the whole list |
| `server/session/surviving-sessions.ts` (new) | the PURE builder (snapshots in, rows out) + the gatherer |
| `server/infra/tmux-routes.ts` | `GET /api/tmux/sessions`, same origin guard as its neighbours |
| `src/composables/useSurvivingSessions.ts` (new) | fetch + row guard + reload |
| `src/components/settings/SurvivingSessionsSection.vue` (new) | the list, and the stop button |
| `src/components/SettingsModal.vue` | mount it |
| `docs/guide/{en,ja}/config.md` | what the section is for |

## Tests

- the builder: ordering (unattached-longest-idle first, attached last), cwd precedence (live pty
  over remembered), what each row reports for a claude / codex / unknown survivor, and that a
  session tmux does not have is not invented.
- the composable: a malformed row is dropped rather than asserted, an older server's answer degrades
  to an empty list.
- the section: stop appears only on unattached rows, posts the row's own key, and reloads.

## Not in this change

- Automatic cleanup (at boot or on a timer) — #1467.
- Making `isResumableTmuxSession` less conservative, and pruning `dev-terminal-sessions.json` — the
  same decision, also #1467.
- Bulk "stop everything idle": one click that ends many live agents is the automatic version wearing
  a button, and the point here is deliberate, per-row control.
