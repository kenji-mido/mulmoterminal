// Whether a listed conversation still has a session RUNNING for it, and under which key.
//
// Deliberately not part of `SessionOccupancy` next door, which answers a different question for a
// different caller: "is a terminal holding this right now", the fact a second cell must know before
// offering to open it. That one is computed from `tmux list-clients` — which reports only sessions
// that HAVE a client, so it is structurally blind to the case here: a session running with nobody
// attached. Those are what a server restart leaves behind, and they piled up unseen because nothing
// in the app could see them either (#1467).
//
// In `common/` because both sides decide from it: the server fills it from its pty table plus
// `tmux list-sessions` (routes/session-routes.ts), and the launcher draws the marker and the stop
// button from it (components/CellLaunchForm.vue).

export interface SessionRunning {
  /**
   * The key of the session running for this row, or null when nothing is.
   *
   * A KEY, not the row's id. A codex/agy conversation started from a grid cell runs under a key
   * MulmoTerminal minted, and only that agent's conversation log connects the two — the same reason
   * `attached` consults it. Terminating the row's id there would kill nothing and report success.
   */
  runningKey: string | null;
}

/**
 * The same field as the CLIENT may receive it — optional, like `PartialSessionOccupancy`: a page
 * left open across an upgrade parses rows from a server that never said. Absent must read as
 * "nothing running", so an older server's rows keep their old behaviour (no marker, no button)
 * rather than offering to stop something that was never asked about.
 */
export type PartialSessionRunning = Partial<SessionRunning>;
