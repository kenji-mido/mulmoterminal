// What a remote-host session is running. The server decides it (from the PtyEntry, or from
// what tmux says is in the pane) and the settings UI offers it as the scope for a quick
// command, so the list of kinds is a value both sides read.
export const SESSION_AGENTS = ["claude", "codex", "antigravity", "shell"] as const;

// Null anywhere this appears means the host cannot tell — a session that outlived a restart
// exists only in tmux, and nothing recorded what launched it. That is distinct from "shell".
export type SessionAgent = (typeof SESSION_AGENTS)[number];

// The agents a terminal can be LAUNCHED as, which is the session kinds minus "shell" (a shell is
// a launcher, not an agent). Claude is first because it is the default everywhere below.
export const TERMINAL_AGENTS = ["claude", "codex", "antigravity"] as const;

export type TerminalAgent = (typeof TERMINAL_AGENTS)[number];

// A remembered agent — a persisted grid cell, a localStorage toggle, a query param — read back.
// Validated rather than cast: anything unrecognised is Claude, which is also what an older
// persisted cell (written before the field existed) means.
export const asTerminalAgent = (value: unknown): TerminalAgent => (TERMINAL_AGENTS.some((agent) => agent === value) ? (value as TerminalAgent) : "claude");

export interface AgentBadge {
  /** Where there is room for it — a sidebar row, a header bar. */
  full: string;
  /** For the tab bar, which fits about two characters between the dot and the title. */
  short: string;
}

// Claude has no badge on purpose: it is the default everywhere, so badging it would put one on
// nearly every row and stop the badge meaning "this one is different". A shell is not an agent
// and reaches this with no entry, which is the same answer.
const AGENT_BADGES: Partial<Record<TerminalAgent, AgentBadge>> = {
  codex: { full: "codex", short: "cx" },
  antigravity: { full: "agy", short: "agy" },
};

/** How a session row announces which agent it is running, or null when it wears no badge. The one
 *  place the wording lives: the sidebar and the tab bar show the SAME list, so a literal compared
 *  in each is how the two came to disagree about a third agent. */
export function agentBadge(agent: string | null | undefined): AgentBadge | null {
  const known = TERMINAL_AGENTS.find((candidate) => candidate === agent);
  return known ? (AGENT_BADGES[known] ?? null) : null;
}
