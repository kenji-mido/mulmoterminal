# fix #1535 — the phone's claude / codex launch stops at the launcher form

## Symptom

From mulmoserver, "+ → claude" (or codex) opens a cell on the desktop grid, but it is the EMPTY
cell-creation screen — the same thing the header `+` button opens. Nothing starts, and nothing
starts later. `shell` works.

## Which side

Neither mulmoserver nor mulmoterminal's server. Both are correct:

- `server/backends/remoteHost/launchTerminal.ts` validates the agent and publishes
  `{ agent, cwd }` on `LAUNCH_TERMINAL_CHANNEL` (verified by its spec).
- `src/App.vue` receives it and calls `openTerminalAt(cwd, null, agent)`.

The bug is in the browser, in what the grid builds from that agent —
`CELL_FOR_AGENT` in `src/components/GridView.vue`:

```ts
claude: (cwd) => ({ session: null, cwd }),
codex:  (cwd) => ({ session: null, cwd, agent: "codex" }),
```

A cell with no session, no command and no launcher IS the empty launcher —
`isLaunchCell()` in `gridTabs.ts` says so, and `TerminalCell` renders `CellLaunchForm`
whenever `initialSessionId === null` (`launched = ref(props.initialSessionId !== null)`).
So the phone's request produced a launch form with the agent PRE-SELECTED and the dir
pre-filled, waiting for someone to press Start.

`shell` works because `shellCell()` carries a `launcher`, which is a running cell.

It never worked: 34841e80 (#831) introduced the mapping in this shape, its comment
("Claude is the plain default") describes a persisted, already-running cell rather than a
fresh one, and no browser-side test covers the channel end to end.

## Why a new field is needed

There is no way to say "a Claude cell that is starting" in `Cell` today. A fresh Claude launch
from the UI is a purely LOCAL transition inside `TerminalCell` (`launchIn()` sets `launched`,
bumps `connectKey`, and the server-generated session id arrives afterwards). The grid only ever
learns about it when the id comes back. So the grid cannot express what it wants here, and the
cell has nothing to act on.

Rejected: giving the agent cells a `launcher`. A launcher cell runs a command on the launcher PTY
path (`agent: "shell"`, no `--mcp-config`, no session accounting) — CLAUDE.md is explicit that a
launcher must run the user's command verbatim and must not become an agent spawn path.

## Change

1. `src/components/gridTabs.ts`
   - `Cell.autoStart?: true` — one-shot, ephemeral: "this cell already knows what it runs; start it
     on mount instead of showing the launcher".
   - It counts as OCCUPIED (`isOccupied`), so `switchPage` does not discard it as an abandoned
     trailing launch cell in the window before its session id arrives, and `addCell` does not
     cancel it. `isLaunchCell` becomes `!isOccupied`, which it already was term for term.
   - `setSession` strips it: once a session exists the flag has done its job, and an emptied cell
     left holding it would count as occupied forever.
2. `src/components/GridView.vue` — every `CELL_FOR_AGENT` entry except `shell` carries
   `autoStart: true`.
3. `src/components/TerminalCell.vue` — `autoStart?: boolean` prop; on mount, when it is set, the
   cell has no session and a cwd is known, call `launchIn(props.initialCwd)`. Once, on mount —
   never a watcher: closing the session (`teardown`) puts this same component back on the launch
   form without unmounting, and a watcher would restart it under the user.
4. `src/components/TerminalGrid.vue` — pass it through.

## Tests

- `test/src/components/gridTabs.spec.ts`: an auto-start cell is occupied / not the launch cell `+`
  cancels / survives `switchPage`; `setSession` clears the flag.
- `test/src/components/phoneLaunchAgent.spec.ts` (new): the two halves the report ran through — the
  real `TerminalCell` renders a terminal rather than `CellLaunchForm` and connects on the requested
  agent's endpoint, and `openTerminalAt` (the seam `App.vue` calls for the published request) opens
  a running cell for every kind in `LAUNCH_AGENTS`, `shell` still as a launcher. The end-to-end
  assertion whose absence let this ship.
- 13 of the new assertions verified RED against the unfixed code.

## Verified against the running app, not only the specs

`yarn dev` on isolated ports under a scratch `HOME` (so the real config is untouched), driven with
Playwright, calling `openTerminalAt(dir, null, agent)` in the page — exactly what `App.vue` does
with the published request:

- before (fix stashed, `claude`): a SECOND cell-creation form, 0 terminals — the report, reproduced.
- after (`claude`): 1 terminal, Claude Code's trust prompt in `~/proj-a`.
- after (`codex`): 1 terminal, codex's own trust prompt — so it reached the codex endpoint, not
  Claude's.

No console errors in any run.
