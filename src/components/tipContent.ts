// What each cell-header chip says when you hover it (#1235).
//
// Pure builders, one per chip, because this is the content the change exists to improve and the
// interesting cases are all absences: a repo with no upstream, a model whose window is unknown, a
// PR whose title has not been fetched. Each builder drops the section it cannot fill rather than
// showing a heading with nothing under it.
import type { GitStatus } from "../../common/gitStatus";
import type { WorkItem } from "../../common/prPhase";
import { phaseDisplay } from "./rosterPhase";

export interface TipSection {
  /** The line that names the thing. */
  head: string;
  /** What it is, in words — a PR's title, an issue's. Absent when nobody could tell us. */
  note?: string;
}

export type TipContent = TipSection[];

const section = (head: string, note: string | null | undefined): TipSection => (note ? { head, note } : { head });

/** The PR and the issue behind it, each with the TITLE — which the desktop has been receiving and
 *  throwing away since #1014, and which is the whole reason a number alone was not enough. */
export function workTip(item: WorkItem): TipContent {
  const phase = phaseDisplay(item.phase);
  const out: TipContent = [];
  // `phase.state`, not `phase.title`: the heading has already said "PR", and the standalone
  // wording says it again — which is the `PR #2689 — PR — CI running` in the report.
  if (item.pr !== null) out.push(section(phase ? `PR #${item.pr} · ${phase.state}` : `PR #${item.pr}`, item.prTitle));
  if (item.issue !== null) out.push(section(`issue #${item.issue}`, item.issueTitle));
  // What the phase had no word for. GitLab knows more about why a request cannot merge than
  // `PrPhase` can express — approvals outstanding, unresolved discussions — and this tip is the
  // one surface with room for the sentence (#981).
  if (item.blockedReason) out.push({ head: item.blockedReason });
  return out;
}

// The counts spelled out as words. `title` said `2 uncommitted · 1 ahead`; the difference here is
// that the branch gets a line of its own, so a long branch name stops competing with the numbers.
export function gitTip(status: GitStatus | null): TipContent {
  if (!status?.repo) return [];
  const counts: string[] = [];
  if (status.dirty > 0) counts.push(`${status.dirty} uncommitted`);
  if (status.upstream && status.ahead > 0) counts.push(`${status.ahead} ahead`);
  if (status.upstream && status.behind > 0) counts.push(`${status.behind} behind`);
  return [{ head: status.detached ? "detached HEAD" : `branch ${status.branch}` }, ...(counts.length ? [{ head: counts.join(" · ") }] : [])];
}

/** A one-line `title` split at the separator it already used, so the model and the context reading
 *  stop sharing a line. Built from the string rather than from the parts because `modelBadge` is
 *  what decides how a context reading is worded (measured / overflow / unknown), and restating
 *  that here would be a second copy of a rule that has three cases. */
export function badgeTip(title: string): TipContent {
  return title
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((head) => ({ head }));
}

/** One line, for the chips whose whole tip is a name or a path. */
export function textTip(text: string | null | undefined): TipContent {
  return text?.trim() ? [{ head: text.trim() }] : [];
}
