// When to offer tidying a cell up (#1182). Its PR has merged, so the worktree and the session are
// finished — but nothing used to say so, and the work-item chip actively HIDES at `merged`
// (`hasWorkToShow`), which took away the last handle on the cell exactly when it stopped being
// needed. Worktrees then accumulated until somebody noticed.
//
// Pure, because "when does a cell nag you" is the whole behaviour and it must be decidable without
// a PTY, a poll or a clock.
import type { PrPhase } from "../../common/prPhase";

export interface TidyPromptState {
  phase: PrPhase;
  pr: number | null;
  /** Only a worktree cell has a room to remove; an ordinary cell has nothing to tidy. */
  isWorktree: boolean;
  /** The PR whose prompt the user already dismissed here, if any. */
  dismissedPr: number | null;
}

export function shouldPromptTidy({ phase, pr, isWorktree, dismissedPr }: TidyPromptState): boolean {
  // A number, not just the phase: the prompt names the PR, and "merged" with nothing to name would
  // be a claim the cell cannot back up.
  if (!isWorktree || phase !== "merged" || pr === null) return false;
  // Dismissed means gone — but keyed to that PR, so a cell reused for the NEXT piece of work
  // prompts again rather than staying silent forever.
  return dismissedPr !== pr;
}
