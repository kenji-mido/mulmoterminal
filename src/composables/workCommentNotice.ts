// Telling the user that their issue is NOT being updated, once (#1369).
//
// `issueWorkComments` fails quietly by design — the work must not stop because a comment could
// not be written. But a read-only `gh` login made the whole feature indistinguishable from having
// it switched off, which is the one thing quiet must not mean.
//
// The dismissal is module state, deliberately shared by every cell: one login produces one cause,
// and nine cells polling the same repo would otherwise ask the user to close nine chips. It is
// keyed by cause, so dismissing "log in" does not also swallow "you may not write here" — those
// have different fixes.
import { ref } from "vue";
import type { WorkCommentFailure } from "../../common/workCommentFailure";

const dismissed = ref<WorkCommentFailure[]>([]);

export const dismissWorkCommentFailure = (failure: WorkCommentFailure): void => {
  if (!dismissed.value.includes(failure)) dismissed.value = [...dismissed.value, failure];
};

/** The cause still worth showing, or null. Reactive, so dismissing in one cell clears the rest. */
export const visibleWorkCommentFailure = (failure: WorkCommentFailure | null): WorkCommentFailure | null =>
  failure !== null && !dismissed.value.includes(failure) ? failure : null;

// Test-only: module state outlives a single case, and a dismissal would leak into the next.
export const clearWorkCommentDismissals = (): void => {
  dismissed.value = [];
};

export interface WorkCommentNoticeText {
  /** The chip itself. Short — it sits in a terminal header next to the branch and the work item. */
  label: string;
  /** The hover, where the fix goes. */
  title: string;
}

// Each cause names its own fix, because they are different fixes: installing a CLI, logging in,
// and being granted write access are not interchangeable, and "something went wrong" would send
// the reader to check all three.
const NOTICE: Record<WorkCommentFailure, WorkCommentNoticeText> = {
  "cli-missing": {
    label: "issue not updated — gh not found",
    title: "MulmoTerminal could not update the issue: the forge CLI is not installed. Install gh (or glab), or turn issueWorkComments off.",
  },
  auth: {
    label: "issue not updated — not logged in",
    title: "MulmoTerminal could not update the issue: run `gh auth login` (`glab auth login` for GitLab).",
  },
  permission: {
    label: "issue not updated — no write access",
    title: "MulmoTerminal could not update the issue: this login may not write on that repository. Issue work comments need write access.",
  },
  unknown: {
    label: "issue not updated",
    title: "MulmoTerminal could not update the issue. The work is unaffected, and the next milestone tries again.",
  },
};

export const workCommentNoticeText = (failure: WorkCommentFailure): WorkCommentNoticeText => NOTICE[failure];
