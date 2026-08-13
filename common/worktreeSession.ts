// What a worktree's single session means for anyone trying to open a terminal in it.
//
// A worktree is one branch, so it holds one session: a second agent started in it is not
// isolation, it is two agents editing the same working tree. Both sides decide from this rule and
// they must agree — the launcher greys a row out, and the server REFUSES the spawn (a path can be
// spelled several ways, and not every client is this launcher), so the two live here together
// rather than as one rule and its paraphrase (#1207).

import type { SessionOccupancy } from "./sessionOccupancy.js";

export type WorktreeAction = "start" | "resume" | "busy";

/** `undefined` — a server that predates the field — reads as "no session", i.e. what every
 *  worktree row did before: start a fresh one. */
export function worktreeAction(session: SessionOccupancy | null | undefined): WorktreeAction {
  if (!session) return "start";
  return session.attached ? "busy" : "resume";
}

/** Why a fresh session is refused here. Named for the READER's next move, since being told a rule
 *  without being told what to do instead is what makes a disabled control read as a bug. */
export function worktreeLimitReason(session: SessionOccupancy): string {
  return session.attached
    ? "this worktree's session is open in another terminal — a worktree runs one session, so close it there first"
    : "this worktree already has a session — resume it from its row instead of starting a second one";
}

/** The same refusal for a session that does not exist YET: two launches aimed at one worktree, the
 *  second arriving while the first is still starting. Server-side only — a client cannot see it. */
export const WORKTREE_LAUNCH_IN_FLIGHT = "a session is already starting in this worktree — a worktree runs one agent session";

/** Why a worktree refuses a fresh session, or null when it does not. The two grounds in one place:
 *  a session that is already there, and one that is still on its way. */
export function worktreeRefusal(session: SessionOccupancy | null, launchInFlight: boolean): string | null {
  if (session) return worktreeLimitReason(session);
  return launchInFlight ? WORKTREE_LAUNCH_IN_FLIGHT : null;
}
