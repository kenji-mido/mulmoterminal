// The ONE session a directory stands for, and whether anyone is holding it.
//
// For a worktree that is the whole model: a worktree is tied to a branch, so a second agent in it
// is not isolation — it is two agents editing one working tree. The launcher therefore offers a
// worktree row as exactly one of three things (start / resume / refuse), and all three need a
// single answer per directory rather than a list to choose from (#1207).

import path from "node:path";
import { canonicalPath } from "../git/worktrees.js";
import { isSessionAttached, type SessionOccupancy } from "../../common/sessionOccupancy.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { isProbeSessionId } from "../agents/probe-session.js";
import { projectSessionsDir } from "./project-dir.js";
import { isBackgroundSession, ptys, translationWorkerIds } from "./registry.js";
import { collectOnDiskSessionStats, safeReaddir } from "./session-reads.js";

export interface DirSession extends SessionOccupancy {
  id: string;
  /** Which agent it is, so a row resumes as that one rather than as the cell's current pick. */
  agent: TerminalAgent;
}

export interface DirSessionCandidate extends DirSession {
  /** A pty for this session is alive in this process. */
  live: boolean;
  /** The transcript's mtime, or the moment of the read for a session yet to write one. */
  mtime: number;
}

// Held beats live beats merely recent. The held one is what a second terminal would collide with,
// so it has to be the one the row reports even when an older conversation in the same directory
// was written to more recently.
function rank(c: DirSessionCandidate): number {
  if (c.attached) return 2;
  return c.live ? 1 : 0;
}

const beats = (c: DirSessionCandidate, best: DirSessionCandidate): boolean => rank(c) > rank(best) || (rank(c) === rank(best) && c.mtime > best.mtime);

/** Pure so the precedence above can be pinned: it is the difference between refusing a directory
 *  someone is working in and handing that person's terminal to a second cell. */
export function pickDirSession(candidates: readonly DirSessionCandidate[]): DirSession | null {
  const best = candidates.reduce<DirSessionCandidate | null>((won, c) => (won === null || beats(c, won) ? c : won), null);
  return best === null ? null : { id: best.id, attached: best.attached, agent: best.agent };
}

// Internal helpers write their transcripts into the same project directory as the user's own
// chats, and one of them can easily be the most recent thing there. Offering to resume a rate-limit
// probe as "the worktree's session" is the failure this excludes.
const isUserSession = (id: string): boolean => !isProbeSessionId(id) && !translationWorkerIds.has(id) && !isBackgroundSession(id);

/** Whether anything is holding this session: a socket in this process, or a tmux client belonging
 *  to another one. `tmuxCounts` comes from a single `tmuxAttachedCounts()` per list. */
export function sessionAttached(id: string, tmuxCounts: Map<string, number> | null): boolean {
  const entry = ptys.get(id);
  return isSessionAttached({
    viewedHere: !!entry?.ws && entry.ws.readyState === entry.ws.OPEN,
    tmuxClients: tmuxCounts === null ? null : (tmuxCounts.get(id) ?? 0),
    holdsTmuxClient: !!entry?.tmux,
  });
}

// A plain shell parked in a worktree is deliberately NOT the worktree's session: it is a terminal
// someone opened, not an agent editing the tree, and refusing the worktree on the strength of one
// would be a lock nobody can see the reason for.
// Matched on the CANONICAL path, not a resolved string: a session started through a symlinked
// spelling of the same worktree would otherwise not be found here, and once its socket closed
// nothing would report the worktree as occupied — least of all for codex or antigravity, which
// have no transcript pass below to fall back on (#1208, found by Codex). Same canonicalization
// `isManagedWorktree` uses to decide the directory is a worktree in the first place.
function livePtyCandidates(dir: string, tmuxCounts: Map<string, number> | null, now: number): DirSessionCandidate[] {
  return [...ptys.entries()].flatMap(([id, entry]) => {
    if (!isUserSession(id) || !isTerminalAgent(entry.agent) || canonicalPath(entry.cwd) !== dir) return [];
    return [{ id, live: true, mtime: now, agent: entry.agent, attached: sessionAttached(id, tmuxCounts) }];
  });
}

// Claude's transcripts are the only agent conversation discoverable from a DIRECTORY: codex keeps
// its rollouts under ~/.codex keyed by its own id, so a codex session that outlived its pty is
// found by the live pass above or not at all. It then reads as "no session here", which starts a
// fresh one — the same thing that happened before this existed.
async function transcriptCandidates(dir: string, tmuxCounts: Map<string, number> | null): Promise<DirSessionCandidate[]> {
  const sessionsDir = projectSessionsDir(dir);
  const files = safeReaddir(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  const stats = await collectOnDiskSessionStats(sessionsDir, files);
  return stats
    .filter((s) => isUserSession(s.id))
    .map((s) => ({ id: s.id, live: false, mtime: s.mtime, agent: "claude" as const, attached: sessionAttached(s.id, tmuxCounts) }));
}

// BOTH spellings, because neither one alone is right (#1208). Claude names its project directory
// after the cwd it was handed, and this app hands over a LEXICALLY resolved path on purpose
// (config/workspace.ts explains why it does not realpath) — so transcripts can sit under the
// caller's spelling. But the caller may equally arrive with git's canonical spelling of a worktree
// reached through a symlink, whose transcripts are under the other name. Looking under one name
// misses the session and lets a second start; looking under both cannot.
async function transcriptCandidatesEitherSpelling(dir: string, tmuxCounts: Map<string, number> | null): Promise<DirSessionCandidate[]> {
  const spellings = [...new Set([path.resolve(dir), canonicalPath(dir)])];
  const found = await Promise.all(spellings.map((spelling) => transcriptCandidates(spelling, tmuxCounts)));
  // Deduped by id: one session listed twice would be picked as itself either way, but a duplicate
  // is a fact about the LOOKUP rather than about the directory, and nothing downstream should have
  // to know that.
  return [...new Map(found.flat().map((candidate) => [candidate.id, candidate])).values()];
}

/** `tmuxCounts` and `now` are passed in so a whole list of directories is answered from one
 *  `list-clients` call and one clock read. */
export async function dirSession(dir: string, tmuxCounts: Map<string, number> | null, now: number): Promise<DirSession | null> {
  const live = livePtyCandidates(canonicalPath(dir), tmuxCounts, now);
  return pickDirSession([...live, ...(await transcriptCandidatesEitherSpelling(dir, tmuxCounts))]);
}
