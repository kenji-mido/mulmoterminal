// Turning what `glab` prints into the rows the PRs & Issues view already renders (#981 step 4).
//
// Pure on purpose, and the only part of GitLab support with real tests: the CLI call around it is
// three lines, while THIS is where a wrong field name silently produces an empty or misleading row.
// The fixtures its spec uses were captured from gitlab.com, not written by hand.
import type { CiState, IssueItem, PrItem } from "../../common/ghItems.js";
import { isRecord } from "../../common/isRecord.js";
import type { PrPhase } from "../../common/prPhase.js";

// GitLab numbers a project's items with `iid` — `id` is globally unique across the instance and is
// NOT what the UI or the URL shows. Using `id` would produce rows whose numbers match nothing.
const itemNumber = (o: Record<string, unknown>): number | null => (typeof o.iid === "number" && Number.isSafeInteger(o.iid) ? o.iid : null);

const authorName = (o: Record<string, unknown>): string => (isRecord(o.author) && typeof o.author.username === "string" ? o.author.username : "");

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function base(raw: unknown): IssueItem | null {
  if (!isRecord(raw)) return null;
  const number = itemNumber(raw);
  // `web_url` is taken as given rather than built: GitLab is moving issues to `/-/work_items/<iid>`
  // and already answers with that path, so composing a URL here would link to the older one.
  const url = text(raw.web_url);
  return number === null || !url ? null : { number, title: text(raw.title), author: authorName(raw), updatedAt: text(raw.updated_at), url };
}

export const normalizeGlabIssue = (raw: unknown): IssueItem | null => base(raw);

// What GitHub splits across `reviewDecision` and `statusCheckRollup`, GitLab collapses into one
// `detailed_merge_status`. Only the values that genuinely mean the same thing are mapped; the rest
// leave the field empty rather than inventing a GitHub verdict for a GitLab state.
//
// Observed across 278 open merge requests on three public projects: not_approved, draft_status,
// unchecked, requested_changes, discussions_not_resolved, mergeable, conflict, ci_must_pass,
// merge_request_blocked.
const REVIEW_BY_MERGE_STATUS: Readonly<Record<string, string>> = {
  requested_changes: "CHANGES_REQUESTED",
  not_approved: "REVIEW_REQUIRED",
};

// The list endpoint carries no pipeline — that needs one call per merge request, which a
// cross-repo list cannot afford. `ci_must_pass` is the one status that says CI is what is holding
// the merge, and even then it does not say whether it failed or is still running, so it reports
// `pending`.
//
// Everything else reports `none`, the same value a GitHub row with no checks carries. That is the
// deliberate limit of this row: `CiState` is GitHub's vocabulary and stays exactly as it is, so a
// GitLab row says no more than a GitHub one can. A merge request whose pipeline is not the blocker
// therefore shows the dim "no checks" dot even when the project does run CI — the honest reading
// is available one click away on the merge request itself.
const ciFromMergeStatus = (status: string): CiState => (status === "ci_must_pass" ? "pending" : "none");

export function normalizeGlabMr(raw: unknown): PrItem | null {
  const item = base(raw);
  if (!item || !isRecord(raw)) return null;
  const mergeStatus = text(raw.detailed_merge_status);
  return {
    ...item,
    // `draft` is its own boolean, so the title prefix does not have to be parsed. `draft_status`
    // says the same thing and is not consulted — one source, not two that can disagree.
    isDraft: raw.draft === true,
    review: REVIEW_BY_MERGE_STATUS[mergeStatus] ?? null,
    ci: ciFromMergeStatus(mergeStatus),
  };
}

/** One issue's detail, from `glab issue view`. GitLab calls the body `description` and numbers the
 *  issue `iid`; `id` is unique across the whole instance and matches nothing a user can look up. */
export function normalizeGlabIssueDetail(raw: unknown): { number: number; title: string; body: string } | null {
  if (!isRecord(raw)) return null;
  const number = itemNumber(raw);
  // An issue with no description is normal — the title is then the whole brief, same as GitHub.
  return number === null ? null : { number, title: text(raw.title), body: text(raw.description) };
}

/** One note from `GET /projects/:id/issues/:iid/notes`. The `id` is what the PUT that edits the
 *  note is addressed to, and is null when the response did not carry a usable one — an
 *  unaddressable note can still be read, just not updated. */
export interface GlabNote {
  id: string | null;
  body: string;
  /** ISO, as GitLab spells it (`created_at`). Null when absent. */
  createdAt: string | null;
}

/** Comments from `GET /projects/:id/issues/:iid/notes`.
 *
 *  `system: true` marks a note GitLab wrote itself — "closed", "changed the description", a label
 *  edit. They are not comments anyone left, and a duplicate check that counted them would decide a
 *  comment already exists because the issue had been closed once (verified against real notes).
 */
export function glabNotes(raw: unknown): GlabNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .filter((note) => note.system !== true)
    .map((note) => ({
      id: typeof note.id === "number" && Number.isSafeInteger(note.id) ? String(note.id) : null,
      body: text(note.body),
      createdAt: typeof note.created_at === "string" && note.created_at !== "" ? note.created_at : null,
    }));
}

/** Whether an issue read from `glab issue view` is still open. GitLab spells it lowercase. */
export const glabIssueIsOpen = (raw: unknown): boolean => isRecord(raw) && raw.state === "opened";

/** The merge request's description, from `glab mr view -F json`. GitLab calls the body
 *  `description`; an empty one is normal and is not a read failure. */
export const glabMrBody = (raw: unknown): string => (isRecord(raw) ? text(raw.description) : "");

export interface FirstGlabMr {
  iid: number;
  url: string | null;
  title: string;
  /** The list row itself, so a failed detail read can still answer from what the list knew. */
  raw: unknown;
}

/** The first merge request in a `glab mr list` answer, or null when the branch has none. */
export function firstGlabMr(raw: unknown): FirstGlabMr | null {
  const first = Array.isArray(raw) ? raw.find(isRecord) : null;
  const iid = first ? itemNumber(first) : null;
  return iid === null || !first ? null : { iid, url: text(first.web_url) || null, title: text(first.title), raw: first };
}

/** The web URL of the first merge request in a `glab mr list` answer, or null when there is none. */
export function glabFirstMrUrl(raw: unknown): string | null {
  const first = Array.isArray(raw) ? raw.find(isRecord) : null;
  const url = first ? text(first.web_url) : "";
  return url || null;
}

// A merge request's phase, in GitHub's vocabulary plus the reason GitHub has no word for.
//
// GitLab collapses into `detailed_merge_status` what GitHub splits three ways, and it is
// INDEPENDENT of the pipeline: observed on real merge requests, `success` with `not_approved` and
// `failed` with `not_approved` both occur, so neither field can be derived from the other.
//
// The phase is chosen to be true rather than precise — `not_approved` is nearer "waiting on
// people" than "ready", and saying `ready` about something that cannot merge is the one answer
// that misleads. `blockedReason` carries what the phase had to drop.
// What GitLab says is standing in the way, in words a reader can act on. A status absent here
// leaves the reason null: an unknown status must not be printed raw into the UI.
const BLOCKED_REASON: Readonly<Record<string, string>> = {
  ci_must_pass: "waiting on CI",
  not_approved: "waiting on approvals",
  discussions_not_resolved: "unresolved discussions",
  merge_request_blocked: "blocked by another merge request",
  conflict: "conflicts with the target branch",
  need_rebase: "needs a rebase",
};

const PIPELINE_FAILED = new Set(["failed", "canceled"]);
const PIPELINE_RUNNING = new Set(["running", "pending", "created", "waiting_for_resource", "preparing", "scheduled"]);

export interface GlabMrPhase {
  phase: PrPhase;
  blockedReason: string | null;
}

/** One merge request's phase. `raw` is a single MR from `glab mr view -F json`. */
export function glabMrPhase(raw: unknown): GlabMrPhase {
  if (!isRecord(raw)) return { phase: "none", blockedReason: null };
  const state = text(raw.state);
  if (state === "merged") return { phase: "merged", blockedReason: null };
  if (state === "closed") return { phase: "closed", blockedReason: null };

  const mergeStatus = text(raw.detailed_merge_status);
  const blockedReason = BLOCKED_REASON[mergeStatus] ?? null;
  // Draft first, like derivePrPhase: it is the author's own "not yet", which outranks anything the
  // project is waiting on.
  if (raw.draft === true) return { phase: "draft", blockedReason };

  const pipeline = isRecord(raw.head_pipeline) ? text(raw.head_pipeline.status) : "";
  if (PIPELINE_FAILED.has(pipeline)) return { phase: "ci-failing", blockedReason };
  if (PIPELINE_RUNNING.has(pipeline)) return { phase: "ci-running", blockedReason };

  // Open, and no pipeline field said otherwise — but that is not the same as green. `ci_must_pass`
  // means CI is what is holding the merge, and a LIST row never carries `head_pipeline` at all, so
  // the fallback path would have called it ready: a green pill on a merge request that cannot
  // merge, which is the one direction of error that matters (Codex review).
  if (mergeStatus === "ci_must_pass") return { phase: "ci-running", blockedReason };
  // `ready` ONLY when GitLab itself says it could merge. Anything else it names is a blocker we may
  // or may not have words for, and guessing "ready" for the ones we do not is the same false green.
  if (mergeStatus === "mergeable") return { phase: "ready", blockedReason: null };
  // Not `ready`, because GitLab named something other than `mergeable` — but no reason either: a
  // status we have no phrase for would put a raw backend identifier in a tooltip, and
  // `detailed_merge_status` is GitLab's internal vocabulary, not words for a reader. The phase
  // alone still says "someone has to act", which is the part that is true (Codex review).
  return { phase: "changes-requested", blockedReason };
}
