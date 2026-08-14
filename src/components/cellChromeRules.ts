// The last of the grid's small display rules: what a failed worktree action says, and when a
// zoom animates.

const REASON_MESSAGES = new Map<string, string>([
  ["not-worktree", "Not a worktree"],
  ["no-branch", "No branch to push"],
  ["no-remote", "No git remote (origin) configured"],
  ["no-forge", "Push succeeded — this remote is on a forge MulmoTerminal cannot open a request on; do it there"],
  ["push-failed", "Push failed"],
  // Removal's two refusals. The launcher sends `force` for a worktree its list showed as dirty, so
  // `dirty` is the one that became dirty since — which is exactly when the user needs telling.
  ["dirty", "It has uncommitted changes — reload the list and confirm again"],
  ["not-managed", "Not a worktree MulmoTerminal created, so it will not remove it"],
  ["failed", "Failed"],
]);

// A Map, not an object literal: indexed by a string that arrives in a server response, an
// object would answer `constructor` or `toString` through its prototype chain — and `?? ` does
// not catch a function, so the UI would render "function Object() { [native code] }" where a
// sentence belongs.
export function worktreeFailureMessage(reason?: string | null): string {
  return REASON_MESSAGES.get(reason ?? "") ?? "Failed";
}

// What a refused worktree REQUEST says. The routes answer a failure in two shapes — `{ error }`
// from create and from every argument check, `{ ok:false, reason }` from remove/push/pr — and the
// sentence naming the cause lives in a different key in each. Showing it at all is #1447's rule:
// a button that swallows the server's reason is a button that "does nothing".
export function worktreeRequestFailure(body: Record<string, unknown>, status: number): string {
  if (typeof body.error === "string" && body.error) return body.error;
  if (typeof body.reason === "string" && body.reason) return worktreeFailureMessage(body.reason);
  return `The request failed (HTTP ${status}).`;
}

// Which cell the zoom transition should fly, given the expanded cell before and after.
export function flipTargetUid(to: number | null | undefined, from: number | null | undefined): number | null {
  return to ?? from ?? null;
}

// Whether that transition should run at all.
//
// Two reasons not to. Swapping between two already-zoomed cells (a cockpit list click) has no
// on-screen source to fly from — the incoming cell sits off-screen in the grid — so the
// animation would start from nowhere. And a user who asked for reduced motion gets none.
export function shouldFlipZoom(to: number | null | undefined, from: number | null | undefined, reducedMotion: boolean): boolean {
  if (flipTargetUid(to, from) === null) return false;
  if (to !== null && to !== undefined && from !== null && from !== undefined) return false;
  return !reducedMotion;
}
