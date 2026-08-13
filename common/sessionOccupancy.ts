// Whether a session is HELD by a terminal right now — the one fact a second terminal has to know
// before it offers to open the same session.
//
// It lives in `common/` because both sides decide from it and neither can derive it alone: the
// server is the only place that can see the other holders (its own pty table, plus tmux for the
// holders belonging to another mulmoterminal process), and the browser is where the row that must
// refuse to be clicked is drawn. Answering it from the current page's grid — the way the
// launcher's `● open` badge used to — is blind to a second browser tab and to a second process,
// which is exactly how a running session gets taken over (#1207).

export interface OccupancyFacts {
  /** A pty in THIS process whose browser socket is still open. */
  viewedHere: boolean;
  /** Clients tmux reports on the session, or null when tmux could not answer. */
  tmuxClients: number | null;
  /** This process holds one of those clients: our pty IS a tmux client, so it must not count as
   *  somebody else. */
  holdsTmuxClient: boolean;
}

/**
 * An unreadable tmux answer reads as NOT attached.
 *
 * The two failures are not symmetric: refusing a worktree its owner is alone in — because a probe
 * failed, or because tmux is not installed at all — is a dead end with nothing to click, while the
 * collision it would have prevented cannot happen without tmux anyway (no tmux, no session that
 * outlives this process for a second one to attach to).
 */
export function isSessionAttached({ viewedHere, tmuxClients, holdsTmuxClient }: OccupancyFacts): boolean {
  if (viewedHere) return true;
  return (tmuxClients ?? 0) > (holdsTmuxClient ? 1 : 0);
}

/** What the server puts on a session row. */
export interface SessionOccupancy {
  attached: boolean;
}

/**
 * The same field as the CLIENT may receive it — optional, like `PartialWorkerStatus` next door and
 * for the same reason: a page left open across an upgrade parses rows from a server that never
 * said. Absent must read as "not attached", so an older server keeps offering its rows rather
 * than disabling every one of them.
 */
export type PartialSessionOccupancy = Partial<SessionOccupancy>;
