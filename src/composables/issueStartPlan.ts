// What the "start work on this issue" control can do for one repo, decided from the repo -> clone
// answer alone (#1173). Pure, because the three outcomes are the whole behaviour of the control
// and each one is a different thing for a user to see: a button, a menu, or a disabled button
// that says why.
import type { RepoDirs } from "../../common/repoDirs";

export type IssueStartPlan =
  /** No clone of this repo on this machine, so there is nowhere for the work to happen. */
  | { kind: "no-clone" }
  /** Exactly one answer — either recorded, or the only candidate. One click starts. */
  | { kind: "ready"; dir: string }
  /** Several clones and nothing recorded yet: the user picks, and the pick is remembered. */
  | { kind: "choose"; dirs: RepoDirs["dirs"] };

export function issueStartPlan(entry: RepoDirs | undefined): IssueStartPlan {
  const dirs = entry?.dirs ?? [];
  if (dirs.length === 0) return { kind: "no-clone" };
  // A recording wins even when the repo has one clone: it is still the same answer, and treating
  // the two cases the same keeps "recorded" from being a state the UI has to distinguish.
  const recorded = entry?.primary;
  if (recorded) return { kind: "ready", dir: recorded };
  if (dirs.length === 1) return { kind: "ready", dir: dirs[0].path };
  return { kind: "choose", dirs };
}

/** Why the control is disabled, for the row's title text. Null when it is not disabled. */
export function issueStartBlockedReason(plan: IssueStartPlan, repo: string): string | null {
  return plan.kind === "no-clone" ? `No local clone of ${repo} — add one to your directory presets to start work here` : null;
}
