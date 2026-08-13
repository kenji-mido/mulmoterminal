// The comment MulmoTerminal leaves on an issue: ONE per (issue, clone), edited as the work moves
// (#979, #1369). Pure, and shared, because the comment is its own storage — the server renders the
// body, reads it back on the next milestone, and appends to what it parsed. A mismatch between the
// two halves would either lose the earlier milestones or post a second comment on every poll.
import { GITHUB_REPO } from "./githubRepo.js";

// A milestone worth telling the issue about. NOT every state the cell passes through: CI is on the
// pull request already, and it flaps, so it is deliberately absent.
export type WorkCommentKind = "start" | "pr" | "merged";

const WORK_COMMENT_KINDS: readonly WorkCommentKind[] = ["start", "pr", "merged"];

export const isWorkCommentKind = (v: unknown): v is WorkCommentKind => WORK_COMMENT_KINDS.some((kind) => kind === v);

/** One milestone. `pr` is the pull request the milestone is about, null when there is none. */
export interface WorkEvent {
  kind: WorkCommentKind;
  /** `YYYY-MM-DD HH:MM UTC`, from the SERVER's clock — see formatWorkTime. */
  at: string;
  pr: number | null;
}

// Only the two kinds that were ever written as a marker: `start` identifies the comment (see
// workAnchorMarker) and `merged` is the second comment older builds left, which is read back so an
// issue upgraded mid-flight does not get told about the same merge twice.
type WorkMarkerKind = "start" | "merged";

// An HTML comment, so it is invisible in the rendered issue but survives a round-trip through the
// GitHub API. Keyed by kind AND directory: the same issue worked on from a second clone is a
// second, honest line in the thread, not a duplicate to suppress.
//
// The directory is percent-encoded, not interpolated raw: a folder may legally be called
// `foo-->bar`, and that string ends the HTML comment early — the rest spills into the rendered
// issue as text (Codex review). Encoding also keeps a newline or a backtick in a path from
// reshaping the comment. Ordinary names encode to themselves, so markers already posted still
// match.
export function workCommentMarker(kind: WorkMarkerKind, dir: string): string {
  return `<!-- mulmoterminal:work:${kind} dir=${encodeURIComponent(dir)} -->`;
}

/** The marker that IDENTIFIES this clone's comment, so later milestones can find it and edit it.
 *  Still spelled `:start` — that is what builds before #1369 wrote, and reusing it is what lets an
 *  already-posted comment be adopted instead of duplicated. */
export const workAnchorMarker = (dir: string): string => workCommentMarker("start", dir);

// The directory a comment names. The BASENAME only: the point is "which of my clones", and a full
// path on a public issue leaks the machine's layout (and, on a work machine, project names).
export function workCommentDirLabel(cwd: string): string {
  // Split-and-take-last rather than trimming a trailing separator with a regex: an anchored
  // `[/\\]+$` backtracks super-linearly, and a path is user input.
  const parts = cwd.split(/[/\\]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? cwd;
}

// Minutes, UTC, spelled out. A reader of the issue is asking "is this claim still alive" — the
// answer needs a date more than it needs seconds, and a fixed zone means two clones in two
// timezones write comparable lines.
export const formatWorkTime = (at: Date): string => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/;

// Says who wrote it, in the rendered comment rather than only in the marker: this lands on other
// people's issues, and a reader should not have to guess which tool is claiming their issue.
const SIGNATURE = `<sub>posted by [MulmoTerminal](https://github.com/${GITHUB_REPO})</sub>`;

// A directory name may legally contain newlines and control characters, and the name is written
// into the headline as-is. The marker below is percent-encoded, but a newline here would put a
// line of the user's choosing into the body — including one that reads back as a milestone.
const displayDir = (dir: string): string =>
  dir
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// The widest number a milestone line can carry. Render and parse have to agree on it: a line this
// side wrote and the parser could not read would vanish from the comment on the NEXT edit, taking
// its milestone with it (Codex review). Ten digits is far more than any forge issues, and the
// pattern below reads exactly that back.
const MAX_LINE_PR = 9_999_999_999;

const writablePr = (pr: number | null): pr is number => pr !== null && Number.isSafeInteger(pr) && pr > 0 && pr <= MAX_LINE_PR;

// The wording of the two states, unchanged from the build that wrote one comment per state: an
// issue that already carries "Working on this in `x`." must not read differently after an edit.
function headline(dir: string, events: readonly WorkEvent[]): string {
  const shown = displayDir(dir);
  const merged = events.find((event) => event.kind === "merged");
  if (!merged) return `Working on this in \`${shown}\`.`;
  // The same bound as the line: the headline is not parsed, but naming a number the line beneath
  // it had to drop would make the comment contradict itself.
  const where = writablePr(merged.pr) ? `Merged in #${merged.pr}.` : "Merged.";
  return `${where} Work done in \`${shown}\`.`;
}

// Null for an event that cannot be written as a line the parser would read back — a PR milestone
// with no number says nothing anyway.
function eventLine(event: WorkEvent): string | null {
  if (event.kind === "start") return `- started — ${event.at}`;
  if (event.kind === "pr") return writablePr(event.pr) ? `- PR #${event.pr} — ${event.at}` : null;
  return writablePr(event.pr) ? `- merged in #${event.pr} — ${event.at}` : `- merged — ${event.at}`;
}

const isLine = (line: string | null): line is string => line !== null;

/** The whole comment body for a clone's milestones so far. Rendered from scratch every time, so
 *  the body is a function of the events and nothing else. */
export function renderWorkComment(dir: string, events: readonly WorkEvent[]): string {
  const lines = events.map(eventLine).filter(isLine);
  return [headline(dir, events), "", ...lines, "", SIGNATURE, "", workAnchorMarker(dir)].join("\n");
}

// MAX_LINE_PR, spelled as digits — the parse half of the same bound. It stops a run of digits out
// of an edited body from reaching the parser as something that would print as `1e+20`, and it
// keeps `\d*` from sitting inside an optional group, which `security/detect-unsafe-regex` reads as
// a backtracking risk (measured as linear here, but a bound is a better answer than an exception).
const PR_DIGITS = "[1-9]\\d{0,9}";
const START_LINE = /^- started — (.+)$/;
const PR_LINE = new RegExp(`^- PR #(${PR_DIGITS}) — (.+)$`);
const MERGED_LINE = new RegExp(`^- merged(?: in #(${PR_DIGITS}))? — (.+)$`);

// Strict about the timestamp on purpose. The body is editable by anyone reading the issue, and
// whatever this returns is written straight back into the next edit — so a line that is not
// exactly what render wrote is dropped rather than echoed.
const timed = (kind: WorkCommentKind, pr: number | null, at: string | undefined): WorkEvent | null =>
  at !== undefined && TIME.test(at) ? { kind, at, pr } : null;

// `Number` is exact for anything the patterns above admit, so there is no second check here: a
// line whose number is longer than that does not match at all, and is dropped like every other
// line that is not exactly what render wrote.
const prNumber = (digits: string | undefined): number | null => (digits === undefined ? null : Number(digits));

function parseEventLine(line: string): WorkEvent | null {
  const started = START_LINE.exec(line);
  if (started) return timed("start", null, started[1]);
  const pr = PR_LINE.exec(line);
  if (pr) return timed("pr", prNumber(pr[1]), pr[2]);
  const merged = MERGED_LINE.exec(line);
  // A merge with no number is a line render writes and reads back, so null is an answer here
  // rather than a failure.
  return merged ? timed("merged", prNumber(merged[1]), merged[2]) : null;
}

/** The milestones a comment body records, in the order it lists them. Empty for a comment written
 *  before #1369 — those carry the marker and the headline but no lines, and the caller supplies
 *  the start from the comment's own creation time. */
export const parseWorkEvents = (body: string): WorkEvent[] =>
  body
    .split("\n")
    // trimEnd, not trim: a body round-tripped through the forge can come back CRLF, and `\r` at the
    // end of the timestamp would fail the strict check above.
    .map((line) => parseEventLine(line.trimEnd()))
    .filter((event): event is WorkEvent => event !== null);

/** `events` with `event` added, or null when the comment already records it — which is the normal
 *  answer, because the caller asks on every poll of every open tab. */
export function withWorkEvent(events: readonly WorkEvent[], event: WorkEvent): WorkEvent[] | null {
  // A PR milestone is its number, and a number the line cannot carry is not a milestone this
  // comment can record — refused here rather than added and then silently dropped by render.
  if (event.kind === "pr" && !writablePr(event.pr)) return null;
  // Matched on the PR number too: a second pull request for the same issue from the same clone —
  // the first one closed unmerged, say — is a new milestone, not a repeat of the old one.
  if (events.some((known) => known.kind === event.kind && known.pr === event.pr)) return null;
  return [...events, event];
}

// Has this exact comment already been left? Matching on the marker rather than the prose means an
// edited comment, or a change to the wording above, still counts as "already said".
export function alreadyCommented(bodies: readonly string[], kind: WorkMarkerKind, dir: string): boolean {
  const marker = workCommentMarker(kind, dir);
  return bodies.some((body) => typeof body === "string" && body.includes(marker));
}
