// What this cell is working on — the branch's PR and the issue behind it — for the header chip.
// Same shape of poll as useGitStatus (mount, cwd change, window focus, a light interval while
// visible), because it answers the same question about the same directory and a user who commits
// or opens a PR expects both chips to catch up together.
//
// The interval is slow on purpose: the server caches each (repo, branch) answer for 30s and the
// call behind it shells out to `gh`, so polling faster buys nothing but subprocesses.
import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";
import { EMPTY_WORK_ITEM, isIssueNumber, isPrPhase, type WorkItem } from "../../common/prPhase";
import { isRecord } from "../../common/isRecord";
import { isIssueWorkCommentsEnabled } from "./issueWorkComments";
import type { WorkCommentKind } from "../../common/workComment";

const POLL_MS = 30_000;

// There is no PR #0 and no negative issue: a stale or malformed response saying so must render
// nothing rather than an impossible link (found by CodeRabbit review).
const numberOrNull = (v: unknown): number | null => (isIssueNumber(v) ? v : null);

// These go straight into an `<a href>`, so the scheme is not the response's decision to make:
// `javascript:` in that attribute runs on click. https only — github.com and GitHub Enterprise
// both serve it, and the cost of refusing anything else is a missing hyperlink next to a number
// that still shows (found by Codex review).
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const safeHttpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v === "") return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
};

// The server is the only writer of this shape, but it is a network response: an old build, a
// proxy returning HTML, or a half-deployed server would otherwise put `undefined` in the chip.
export function parseWorkItem(data: unknown): WorkItem {
  if (!isRecord(data) || !isPrPhase(data.phase)) return { ...EMPTY_WORK_ITEM };
  return {
    phase: data.phase,
    pr: numberOrNull(data.pr),
    prUrl: safeHttpsUrl(data.prUrl),
    issue: numberOrNull(data.issue),
    issueUrl: safeHttpsUrl(data.issueUrl),
    // The chip shows numbers, not words — the titles ride along for the phone (#1014), and are
    // parsed here so the wire type has one reader rather than two disagreeing ones.
    prTitle: textOrNull(data.prTitle),
    issueTitle: textOrNull(data.issueTitle),
  };
}

// Nothing to show: no PR, no issue — or the PR is merged, which is the point at which the cell
// has stopped working on it (#979). A closed PR reads the same way.
export function hasWorkToShow(item: WorkItem): boolean {
  if (item.phase === "merged" || item.phase === "closed") return false;
  return item.pr !== null || item.issue !== null;
}

// What the cell should tell the issue, comparing the poll before with the poll now (#979 Phase 2).
// A cell arriving on an issue says so once; a PR turning `merged` reports the merge. Everything
// else — an unchanged state, a phase moving inside the review loop — says nothing.
//
// "Arriving" includes the first poll after a reload, on purpose: this side cannot know what was
// already said, only the issue can. The server is idempotent, so re-asking is the design, not a
// leak — see server/git/work-comment.ts.
export function workCommentToPost(before: WorkItem, now: WorkItem): WorkCommentKind | null {
  if (now.issue === null) return null;
  // "Merged" is only reportable when this session WATCHED it happen: the same PR was here on the
  // previous poll and was not merged yet. Arriving at a merged state is not the same event — a
  // reload, or a cell left on last month's branch, would otherwise announce (and try to close)
  // issues that were finished long ago, all at once, the first time the setting is switched on.
  if (now.phase === "merged") return before.pr !== null && before.pr === now.pr && before.phase !== "merged" ? "merged" : null;
  if (now.phase === "closed") return null;
  // "Start" is safe to repeat after a reload — it is a standing fact, not an event, and the
  // server writes it at most once per (issue, directory).
  return before.issue === now.issue ? null : "start";
}

async function postWorkComment(cwd: string, item: WorkItem, kind: WorkCommentKind): Promise<void> {
  try {
    await fetch("/api/work-comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, issue: item.issue, pr: item.pr, kind }),
    });
  } catch {
    // Best-effort: the next transition (or the next reload) asks again, and the server dedupes.
  }
}

export function useWorkItem(cwd: Ref<string | null>) {
  const item = ref<WorkItem>({ ...EMPTY_WORK_ITEM });
  let req = 0;

  async function refresh(): Promise<void> {
    // Bumped before the early return for the same reason as useGitStatus: a cell losing its dir
    // must invalidate an in-flight fetch, or the previous dir's PR reappears in the header.
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      item.value = { ...EMPTY_WORK_ITEM };
      return;
    }
    try {
      const res = await fetch(`/api/pr-phase?cwd=${encodeURIComponent(dir)}`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my !== req) return;
      const next = parseWorkItem(data);
      const kind = isIssueWorkCommentsEnabled() ? workCommentToPost(item.value, next) : null;
      item.value = next;
      if (kind) void postWorkComment(dir, next, kind);
    } catch {
      // leave the last value; the next tick retries
    }
  }

  const refreshIfVisible = () => {
    if (document.visibilityState === "visible") void refresh();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void refresh();
    window.addEventListener("focus", refreshIfVisible);
    // Switching browser TABS fires this and not `focus`, and at a 30s cadence a returning tab
    // would otherwise show the previous PR state for most of a minute (CodeRabbit review).
    document.addEventListener("visibilitychange", refreshIfVisible);
    timer = setInterval(refreshIfVisible, POLL_MS);
  });
  onUnmounted(() => {
    window.removeEventListener("focus", refreshIfVisible);
    document.removeEventListener("visibilitychange", refreshIfVisible);
    if (timer) clearInterval(timer);
  });
  watch(cwd, () => void refresh());

  return { item, refresh };
}
