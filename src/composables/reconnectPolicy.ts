// Whether a dropped terminal socket should come back, and how long to wait before trying.
//
// Split from the connection manager because both halves are decisions with consequences the
// manager's own tests can't reach: reconnecting something that should stay down re-runs a
// command the user watched finish, or has two browser tabs take turns evicting each other
// forever, while a broken backoff turns one server restart into a reconnect storm.

// 500ms, doubling, capped at 5s. The cap is what keeps a server that is down (rather than
// restarting) from being hammered.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export interface ReconnectFacts {
  // The slot was torn down deliberately — nothing should bring it back.
  released: boolean;
  // The session ended on purpose (an exit frame, or another tab superseded this one).
  // Reconnecting here is how two tabs end up fighting over one session.
  sawExit: boolean;
  // A retry is already armed; a second one would double the rate every drop.
  reconnectPending: boolean;
  // A Run cell's process is unique and unresumable — reconnecting would re-run the command.
  isCommand: boolean;
}

// Whether the connection is coming back at all — the question anything TELLING THE USER has to
// answer, and a different one from `shouldReconnect`. Blind to `reconnectPending` on purpose: an
// armed retry makes "schedule another?" false while making "is one coming?" as true as it gets, so
// asking the wrong one promises a reconnect exactly when there is none and denies it when there is.
export function connectionWillReturn({ released, sawExit, isCommand }: Omit<ReconnectFacts, "reconnectPending">): boolean {
  return !released && !sawExit && !isCommand;
}

export function shouldReconnect(facts: ReconnectFacts): boolean {
  return connectionWillReturn(facts) && !facts.reconnectPending;
}

// Exponential backoff by attempt number (0 = the first retry after a drop).
export function reconnectDelayMs(attempts: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
}
