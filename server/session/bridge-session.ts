// Which SESSION a GUI MCP bridge process belongs to, when nothing told it.
//
// Every other host hands the answer over: claude and codex get a session-scoped URL at spawn, and
// agy and grok read a config file whose server entry the session's own environment completes
// (guiMcpEnv — the bridge is their child, so it inherits it).
//
// muse breaks that, and it is not a detail that can be worked around at the call site: a plugin's
// MCP server is started with a CURATED ENVIRONMENT — measured at 16 variables, all of them muse's
// own (MUSE_PLUGIN_ROOT, PATH, HOME, TMPDIR …) — and neither the muse process's environment nor
// the manifest's own `env` block reaches it. So the bridge starts knowing its group and its port
// (both are argv, which IS ours) and nothing at all about the session.
//
// Two things do survive, and between them they answer it:
//
//   THE PROCESS TREE. The bridge is a descendant of the muse process, which is the root process of
//   the tmux pane whose session name is the session id this server minted. `tmux list-panes` maps
//   that pane pid to that name, so walking up from the bridge until a pane pid is hit is exact —
//   it distinguishes two muse cells in ONE directory, which nothing else here can.
//
//   THE PTY. With tmux persistence off there is no pane to match, and there the muse process IS a
//   child of the pty this server spawned — so the pty's own pid appears in the same chain.
//
// The working directory is deliberately NOT one of them, and that is a correction: a cwd fallback
// ("the single live muse session in this directory") shipped first and is unsafe, because the
// plugin is machine-wide. A muse the USER started in a normal terminal, in a directory that also
// holds one of our cells, matches no pane and no pty of ours — and would have been handed that
// cell's session id and groups, letting an unrelated process draw into someone's Canvas and write
// artifacts under their session (Codex review on #1514). Both facts above are proofs of descent;
// a shared directory is not.
import { ptys } from "./registry.js";
import type { ToolGroup } from "../../common/toolGroups.js";

/** What the resolver needs to know about the world, so the rule itself is pure and testable. */
export interface BridgeSessionFacts {
  /** Pane root pid -> session id, from tmux. */
  panePids: ReadonlyMap<number, string>;
  /** The ancestors of the bridge, nearest first, INCLUDING its own pid. */
  ancestors: readonly number[];
  /** Live sessions running muse, as id -> the pid of the pty this server spawned for it. */
  museSessions: ReadonlyMap<string, number>;
}

/**
 * The session a bridge belongs to, or null when it cannot be shown to belong to any.
 *
 * Null is a real answer and the important one: the bridge then serves NO tools, rather than some
 * other session's. Every path here is a proof of DESCENT — this process runs under that session's
 * pane, or under its pty — so a muse nobody here started can never claim one. A missing chart is a
 * failure the user can see and report; a chart drawn in the wrong cell is not.
 */
export function resolveBridgeSession(facts: BridgeSessionFacts): string | null {
  const ptyOwners = new Map([...facts.museSessions].map(([id, pid]) => [pid, id]));
  for (const pid of facts.ancestors) {
    const pane = facts.panePids.get(pid);
    if (pane && facts.museSessions.has(pane)) return pane;
    const pty = ptyOwners.get(pid);
    if (pty) return pty;
  }
  return null;
}

// ── the groups half ───────────────────────────────────────────────────────────────────────────
//
// Once the session is known, what may it reach? For agy and grok that question is already answered
// by the file the agent read; muse's plugin is installed for the MACHINE and declares every group,
// so the answer has to come from here — recorded at spawn, when the directory's registration was
// read, and read back by the resolve route.
//
// In memory only, and deliberately: it describes a RUNNING session, so a server restart that
// forgets it has also lost the pty it describes. The entry is dropped when the session ends.
const groupsBySession = new Map<string, readonly ToolGroup[]>();

export function rememberEntitledToolGroups(sessionId: string, groups: readonly ToolGroup[]): void {
  groupsBySession.set(sessionId, [...groups]);
}

export function forgetEntitledToolGroups(sessionId: string): void {
  groupsBySession.delete(sessionId);
}

/** What this session may reach. Named for ENTITLEMENT, not to be confused with registry's
 *  `sessionToolGroups`, which records what a session has been OBSERVED reaching — that one is
 *  learned from connections and drives the Canvas gate; this one is decided at spawn and drives
 *  what a bridge is allowed to serve.
 *
 *  An unknown session answers NOTHING rather than everything: a bridge asking about a session we
 *  have no record of is a bridge we cannot vouch for. */
export const entitledToolGroups = (sessionId: string): readonly ToolGroup[] => groupsBySession.get(sessionId) ?? [];

/** The live muse sessions and the pty pid behind each — the world the rule above is applied to.
 *
 *  muse-only on purpose: the other hosts are TOLD their session, and a process tree is a weaker
 *  claim than being told. Widening this would let a bridge that lost its environment claim a
 *  claude session by standing near it.  */
export function liveMuseSessions(): Map<string, number> {
  const sessions = new Map<string, number>();
  for (const [id, entry] of ptys) if (entry.agent === "muse") sessions.set(id, entry.term.pid);
  return sessions;
}
