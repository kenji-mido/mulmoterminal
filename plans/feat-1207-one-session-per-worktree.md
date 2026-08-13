# One session per worktree, and an honest "already open"

Fixes #1207.

## Why

A user working in a worktree opened a second terminal for it and landed on the session that was
already running. Their question was the right one: is a terminal tied to the folder, or to the
session?

It is tied to the **session id**. tmux holds `mt-<id>` on our own tmux server, claude runs under
`--session-id <id>` / `--resume <id>`, and cwd is only a launch parameter recorded as `id -> cwd`
(`server/session/dev-terminal-cwds.ts`). Nothing looks a session up by directory, so a fresh launch
(`launchIn` sends no id) always mints a new one and can never collide.

Three paths ask for an id that already exists, and all three miss the same fact:

| | how a live session gets taken over | guard today |
| --- | --- | --- |
| A | the launcher's `or resume here` row, which lists the running grid session too | `● open` + a confirm, but ONLY when that id is a cell in this browser's grid |
| B | a second browser tab on the same origin restores the same localStorage grid and every cell reattaches | none |
| C | a second `mulmoterminal` process: `hasLivePty` is false there, so `tmux new-session -A` attaches a SECOND client and `window-size latest` makes the two sizes fight | a CLI warning at startup; nothing in the UI |

One cause underneath: **"is this session open somewhere?" is answered from the current browser's
grid**, while the server is the only thing that can answer it — it holds the pty table for this
process and can ask tmux about every other one.

## What

### 1. The server answers "attached"

`common/sessionOccupancy.ts` — the wire field plus the rule, shared because both sides read it:

```ts
export function isSessionAttached(facts: OccupancyFacts): boolean;
```

from `viewedHere` (a pty in this process whose socket is still open), `tmuxClients`, and
`holdsTmuxClient` (our own pty IS one of those clients, so it must be subtracted).

An unreadable tmux answer counts as **not** attached. Locking someone out of their own worktree
because a probe failed is worse than the collision it would prevent, and without tmux there is no
cross-process session to collide with in the first place.

`tmuxAttachedCounts()` in `server/infra/tmux.ts` gets every session's client count from ONE
`list-clients` call, so a list of rows costs one spawn rather than one per row.

### 2. One session per worktree

`/api/worktrees` rows gain `session: { id, attached } | null` — the newest resumable session for
that worktree path, and whether anyone holds it. The row then means one of three things:

- **no session** — start a fresh one (unchanged)
- **a session nobody is holding** — the row resumes it, rather than starting a second one
- **a session someone is holding** — the row is disabled and says so

A worktree is tied to a branch, so a second agent in it is not isolation, it is two agents editing
one working tree. The section says that in one line, which is also why there is no "resume which
one?" picker to get lost in.

The refusal belongs to the DIRECTORY, not to the row. A worktree is reachable without touching its
row — pasted into the working-directory field, or picked from a recent-dir chip, which worktrees
become as soon as one is launched in — so the field's play button, its Enter key and the chip's
launch button consult the same answer. (`＋ New worktree` needs no guard: a repeated task name gets
a fresh unique branch, never an existing worktree.)

**The client's answer is the explanation; the server's is the guarantee.** Codex, reviewing the
first version, found the launcher comparing `w.path === dir` — so `/wt/x/` or `/repo/../wt/x` typed
into the field walked straight past a row marked `in use`. Normalizing the comparison fixes those
spellings and nothing else: a symlinked path, a chip into a repo whose worktree list was never
fetched, the phone, and the remote-host bridge all still reach a spawn. So the rule is enforced
where the session is actually created (`session/worktree-session-limit.ts`, wired into the three
agent WebSocket handlers), using the realpath containment check `isManagedWorktree` already does.
The client keeps a lexical `dirPathKey` comparison so the control greys out *before* the click.

A plain shell is exempt on both sides: the limit is on agents sharing one working tree, and
`dir-session.ts` leaves shells out of the answer for the same reason.

**The check and the spawn have to be one step.** Reading the occupancy is asynchronous (git, then
the filesystem), so two launches aimed at one worktree could both find it free and both spawn —
Codex's third finding. `claimLaunch()` stakes a claim keyed by canonical path, and everything up to
and including the increment is synchronous, so nothing can await between reading the count and
raising it. It is a counter rather than a flag: the refused second launch releases on its way out,
and that must not cancel the first one's claim. The claim rides the socket's `close`, which covers
every early return and a client that leaves mid-check; holding it past the spawn costs nothing,
since the pty then occupies the worktree on its own account.

**`OR LAUNCH` is a command line, so the limit follows what it runs.** Codex found the fourth
endpoint on the second pass: a launcher configured as `codex` reached a spawn without the guard.
Refusing every launcher would have been worse — a worktree an agent is working in is exactly where
`yarn dev` or `lazygit` belongs — so `launcherRunsAgent()` reuses the program recogniser this file
already trusts for the codex MCP injection. A command line therefore reads as an agent to both or
to neither, and an unrecognised shape (`FOO=1 codex`, a wrapper script) is allowed through, which
is the direction that never stands between someone and their own tools.

### 3. The resume list stops offering what it cannot give

`/api/sessions` rows gain the same `attached` field, and an attached row is disabled with the
reason on it. This is what closes B and C: the badge no longer depends on the browser having the
other viewer in its own grid.

A launcher that runs an agent is also RECORDED as that agent (`launcherAgent()`), so it is the
worktree's occupant afterwards and not only refused on the way in. What stays uncovered is a
command line the recogniser cannot read — `FOO=1 codex`, `env codex`, a wrapper script. That is
deliberate: the recogniser is shared with the MCP injection, whose "do not see through a wrapper"
rule is a decision with its own tests, and a guard that were cleverer than the injection would make
one command line read as codex to one and not the other. Parsing shell syntax to decide whether to
REFUSE someone a terminal is also the wrong direction to be clever in.

## Known limits

Two, both narrow, both stated rather than papered over:

- **A transcript written under a spelling nobody asks by.** The occupancy read looks under the
  spelling the launch arrives by AND its canonical form, which covers a launch arriving by an
  alias. The reverse — a session once started through a symlink alias, later launched against by
  the canonical path, with no live pty left — cannot be resolved without enumerating every symlink
  that points at the directory. Closing it properly means consulting the recorded per-session cwds
  (`registry.sessionCwd`), which is a realpath syscall per recorded session on a list endpoint that
  reloads while the user types; not worth it for the case.
- **A launcher command line the recogniser cannot read** (`FOO=1 codex`, a wrapper script) — see
  above.

## Not done here

- No cross-process lock or handover. "Open elsewhere" is reported and refused, not stolen.
- The pre-existing confirm for taking over a session in the same grid goes away with it — a
  disabled row with a reason replaces a dialog that could be clicked through.
