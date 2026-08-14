// What a cockpit roster row says it is RUNNING, which is not the same question as `Cell.agent`.
//
// That field is absent for Claude — the default, stored as the absence of the key — and equally
// absent for every cell that is no agent session at all: a launcher chip, an ephemeral run-command
// cell, a cell nobody has launched in yet. Reading it as "claude" therefore put Anthropic's mark on
// all of them, so the roster claimed a `yarn dev` chip was a Claude session (the row wore the
// agent's NAME before, and only for non-Claude agents, so the collision had nothing to show).
//
// Asked of the cell's KIND first, then of its agent:
//
//   - a launcher and a command cell both run the user's own command line, and this answers "shell"
//     whatever that line names. It is the same answer the server records (spawnLauncherPty writes
//     `agent: "shell"` however the command is spelled) and the same rule as CLAUDE.md's: nothing
//     here parses a launcher command. A `button` RunCommand does carry an `agent`, but that is the
//     session context the button was resolved against — not what the command cell itself runs.
//   - a session cell keeps its agent, defaulting to Claude for the absent case that really is one.
//   - a cell running nothing answers null, and the header marks it with nothing at all: the status
//     dot and the directory already identify the row, and any mark would be a guess.
import type { Cell } from "./gridTabs";
import type { SessionAgent } from "../../common/sessionAgent";

export const rosterAgent = (c: Cell): SessionAgent | null => {
  if (c.command || c.launcher) return "shell";
  return c.session ? (c.agent ?? "claude") : null;
};
