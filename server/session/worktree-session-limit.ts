// The one-session-per-worktree rule, enforced where a session is actually created.
//
// The launcher greys the row out, but that is the explanation, not the guarantee: a directory can
// be spelled several ways (`/wt/x/`, `/repo/../wt/x`, a symlinked root), a chip can point into a
// repo whose worktree list the form never fetched, and the phone and the remote-host bridge open
// terminals without the form at all. Codex raised the first of those on #1208; all of them are the
// same hole, and this is the choke point that closes it for every client at once.
//
// Only a MANAGED worktree is limited. An ordinary directory takes as many terminals as the user
// wants — that is what the grid is for.

import { canonicalPath, isManagedWorktree, repoRoot } from "../git/worktrees.js";
import { tmuxAttachedCounts } from "../infra/tmux.js";
import { dirSession, type DirSession } from "./dir-session.js";

export interface WorktreeOccupancy {
  /** Whether the directory is a managed worktree at all. Only those are limited. */
  isWorktree: boolean;
  /** The session already there, if any. */
  session: DirSession | null;
}

const NOT_A_WORKTREE: WorktreeOccupancy = { isWorktree: false, session: null };

/**
 * Whether `cwd` is a managed worktree, and which session already occupies it.
 *
 * A directory that cannot be resolved reads as "not a worktree": git failing is not a reason to
 * refuse someone a terminal. `isManagedWorktree` canonicalizes both sides through realpath, which
 * is also what path aliases cannot slip past.
 */
export async function worktreeOccupancy(cwd: string): Promise<WorktreeOccupancy> {
  const repo = await repoRoot(cwd).catch(() => null);
  if (!repo || !isManagedWorktree(repo, cwd)) return NOT_A_WORKTREE;
  return { isWorktree: true, session: await dirSession(cwd, tmuxAttachedCounts(), Date.now()) };
}

// Launches on their way into a directory but not yet visible as a pty, counted by canonical path.
//
// The occupancy read above is asynchronous (git, then the filesystem), so two launches aimed at one
// worktree can both look it up, both find it free, and both spawn — the race Codex found on #1208.
// A COUNTER rather than a set: every launch releases its own, so a refused second one cannot cancel
// the first one's claim on the way out.
const launchesInFlight = new Map<string, number>();

export interface WorktreeClaim {
  /** True when another launch was already on its way into this directory. */
  contended: boolean;
  /** Idempotent, so both the socket's close and an explicit release can call it. */
  release: () => void;
}

/**
 * Stake a claim on `cwd` for a launch about to happen.
 *
 * Synchronous up to and including the increment — that is the whole point. Nothing may await
 * between reading the count and raising it, or two launches read the same zero.
 *
 * Over-holding a claim is harmless: once the launch has spawned, its pty makes the worktree
 * occupied anyway, so the claim only has to cover the gap until then.
 */
export function claimLaunch(cwd: string): WorktreeClaim {
  const key = canonicalPath(cwd);
  const held = launchesInFlight.get(key) ?? 0;
  launchesInFlight.set(key, held + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const remaining = (launchesInFlight.get(key) ?? 1) - 1;
    if (remaining > 0) launchesInFlight.set(key, remaining);
    else launchesInFlight.delete(key);
  };
  return { contended: held > 0, release };
}
