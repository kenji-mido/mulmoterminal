// The chip that says which PR / issue a cell is on. Two things decide what a user sees: whether
// there is anything to show at all (a merged PR must vanish, #979), and how a server response is
// read into the shape the template trusts.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WorkItemChip from "../../../src/components/WorkItemChip.vue";
import { hasWorkToShow, parseWorkItem, workCommentToPost } from "../../../src/composables/useWorkItem";
import { EMPTY_WORK_ITEM, type WorkItem } from "../../../common/prPhase";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({ ...EMPTY_WORK_ITEM, ...over });

describe("hasWorkToShow", () => {
  it("shows a PR with its issue", () => {
    expect(hasWorkToShow(item({ phase: "ready", pr: 977, issue: 966 }))).toBe(true);
  });

  // Most of the time a cell spends on an issue, there is no PR yet.
  it("shows an issue that has no PR yet", () => {
    expect(hasWorkToShow(item({ phase: "none", issue: 979 }))).toBe(true);
  });

  it("shows a PR that closes no issue", () => {
    expect(hasWorkToShow(item({ phase: "ci-running", pr: 977 }))).toBe(true);
  });

  // The clear-on-merge rule: the work is over, and a badge left behind is what makes the header
  // untrustworthy in the first place.
  it.each(["merged", "closed"] as const)("shows nothing once the PR is %s", (phase) => {
    expect(hasWorkToShow(item({ phase, pr: 977, issue: 966 }))).toBe(false);
  });

  it("shows nothing for a cell with neither", () => {
    expect(hasWorkToShow(item())).toBe(false);
  });
});

describe("parseWorkItem", () => {
  it("reads the server's shape", () => {
    const parsed = parseWorkItem({
      phase: "ready",
      pr: 977,
      prUrl: "https://x/pull/977",
      issue: 966,
      issueUrl: "https://x/issues/966",
      prTitle: "the change",
      issueTitle: "the report",

      blockedReason: null,
    });
    expect(parsed).toEqual({
      phase: "ready",
      pr: 977,
      prUrl: "https://x/pull/977",
      issue: 966,
      issueUrl: "https://x/issues/966",
      prTitle: "the change",
      issueTitle: "the report",

      blockedReason: null,
    });
  });

  // A proxy answering HTML, or an older server that only knows `phase`/`url`, must not put
  // `undefined` in the template.
  it.each([
    ["a body that is not an object", "<!doctype html>"],
    ["null", null],
    ["an unknown phase", { phase: "shipped", pr: 1 }],
    ["no phase at all", { pr: 1 }],
  ])("falls back to empty for %s", (_label, data) => {
    expect(parseWorkItem(data)).toEqual(EMPTY_WORK_ITEM);
  });

  // The URLs are rendered as `<a href>`. A scheme the browser executes on click has no business
  // reaching that attribute, whatever the response says (Codex review).
  it.each([
    ["javascript", "javascript:alert(1)"],
    ["JavaScript with padding", "  javascript:alert(1)"],
    ["uppercase javascript", "JAVASCRIPT:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["a relative path", "/o/r/pull/977"],
    ["a bare word", "not-a-url"],
    ["a scheme that is not https", "ftp://example.com/pull/977"],
  ])("refuses %s as a link", (_label, url) => {
    const parsed = parseWorkItem({ phase: "ready", pr: 977, prUrl: url, issue: 966, issueUrl: url });
    expect(parsed.prUrl).toBeNull();
    expect(parsed.issueUrl).toBeNull();
    expect(parsed.pr).toBe(977); // the number still shows; only the link is withheld
  });

  it.each([
    ["github.com", "https://github.com/o/r/pull/977"],
    ["a GitHub Enterprise host", "https://ghe.internal/o/r/pull/977"],
  ])("keeps %s", (_label, url) => {
    expect(parseWorkItem({ phase: "ready", pr: 977, prUrl: url }).prUrl).toBe(url);
  });

  // There is no PR #0 and no negative issue (CodeRabbit review).
  it.each([0, -3])("refuses %i as an identifier", (n) => {
    const parsed = parseWorkItem({ phase: "ready", pr: n, issue: n });
    expect(parsed.pr).toBeNull();
    expect(parsed.issue).toBeNull();
  });

  it("drops field values of the wrong type rather than showing them", () => {
    expect(parseWorkItem({ phase: "ready", pr: "977", prUrl: 3, issue: 1.5, issueUrl: "" })).toEqual({ ...EMPTY_WORK_ITEM, phase: "ready" });
  });
});

describe("WorkItemChip", () => {
  it("renders the PR, the issue and the phase, each linked", () => {
    const w = mount(WorkItemChip, {
      props: { item: item({ phase: "ready", pr: 977, prUrl: "https://x/pull/977", issue: 966, issueUrl: "https://x/issues/966" }) },
    });
    expect(w.get('[data-testid="work-pr"]').text()).toBe("#977");
    expect(w.get('[data-testid="work-pr"]').attributes("href")).toBe("https://x/pull/977");
    expect(w.get('[data-testid="work-issue"]').text()).toBe("#966");
    expect(w.get('[data-testid="work-issue"]').attributes("href")).toBe("https://x/issues/966");
    expect(w.get('[data-testid="work-phase"]').text()).toBe("ready");
    // The detail moved to the shared hover tip (#1235) — see tipContent.spec.ts. The native
    // attribute must be gone, or the browser's own slow tooltip appears on top of the new one.
    expect(w.get('[data-testid="work-chip"]').attributes("title")).toBeUndefined();
  });

  it("renders the issue alone before a PR exists, with no arrow", () => {
    const w = mount(WorkItemChip, { props: { item: item({ phase: "none", issue: 979, issueUrl: "https://x/issues/979" }) } });
    expect(w.get('[data-testid="work-issue"]').text()).toBe("#979");
    expect(w.find('[data-testid="work-pr"]').exists()).toBe(false);
    expect(w.find('[data-testid="work-arrow"]').exists()).toBe(false);
    expect(w.find('[data-testid="work-phase"]').exists()).toBe(false); // "none" has no label
  });

  it.each(["merged", "closed"] as const)("renders nothing at all once %s", (phase) => {
    const w = mount(WorkItemChip, { props: { item: item({ phase, pr: 977, issue: 966 }) } });
    expect(w.find('[data-testid="work-chip"]').exists()).toBe(false);
  });
});

// Which transition is worth telling the issue about (#979 Phase 2). The client only decides WHEN
// to ask; the server decides whether anything gets written, so the bar here is "did the cell's
// situation actually change", not "has this been said before".
describe("workCommentToPost", () => {
  it("announces a cell arriving on an issue", () => {
    expect(workCommentToPost(item(), item({ phase: "none", issue: 979 }))).toBe("start");
  });

  // A reload starts from nothing, and this side cannot know what was already said — the server's
  // idempotency is what makes re-asking correct.
  it("announces again after a reload, and lets the server dedupe", () => {
    expect(workCommentToPost({ ...EMPTY_WORK_ITEM }, item({ phase: "ready", pr: 983, issue: 979 }))).toBe("start");
  });

  it("says nothing while the same issue keeps being worked on", () => {
    const before = item({ phase: "ci-running", pr: 983, issue: 979 });
    expect(workCommentToPost(before, item({ phase: "ready", pr: 983, issue: 979 }))).toBeNull();
  });

  it("announces the merge", () => {
    const before = item({ phase: "ready", pr: 983, issue: 979 });
    expect(workCommentToPost(before, item({ phase: "merged", pr: 983, issue: 979 }))).toBe("merged");
  });

  it("announces a PR that appeared while this cell watched the issue", () => {
    const before = item({ phase: "none", issue: 979 });
    expect(workCommentToPost(before, item({ phase: "ci-running", pr: 983, issue: 979 }))).toBe("pr");
  });

  // Unlike "start", the PR milestone is STAMPED with a time. A reload finding a month-old PR knows
  // only when it noticed, so it says nothing rather than dating the work to the reload.
  it("does not announce a PR it did not watch appear", () => {
    expect(workCommentToPost({ ...EMPTY_WORK_ITEM }, item({ phase: "ready", pr: 983, issue: 979 }))).toBe("start");
    const arrived = item({ phase: "ready", pr: 983, issue: 979 });
    expect(workCommentToPost(arrived, arrived)).toBeNull();
  });

  // CI going red and green again is on the pull request already, and it flaps.
  it("says nothing about the phases inside the review loop", () => {
    const before = item({ phase: "ci-running", pr: 983, issue: 979 });
    expect(workCommentToPost(before, item({ phase: "ci-failing", pr: 983, issue: 979 }))).toBeNull();
  });

  // The first PR was closed unmerged and another was opened for the same issue. That is a
  // milestone of its own, and the server keys the line by number, so it is not a repeat.
  it("announces the second PR after the first one was closed", () => {
    const before = item({ phase: "closed", pr: 983, issue: 979 });
    expect(workCommentToPost(before, item({ phase: "draft", pr: 990, issue: 979 }))).toBe("pr");
  });

  // The burst this rule exists to prevent: switching the setting on, or just reloading, with
  // cells parked on branches whose PRs merged weeks ago. Arriving at "merged" is not watching a
  // merge, and those issues are finished — commenting on (and closing) them would be noise on
  // somebody else's thread.
  it("does not announce a merge it did not watch happen", () => {
    const arrived = item({ phase: "merged", pr: 983, issue: 979 });
    expect(workCommentToPost({ ...EMPTY_WORK_ITEM }, arrived)).toBeNull();
  });

  it("does not announce a merge for a PR it had not seen before", () => {
    const before = item({ phase: "ready", pr: 900, issue: 800 });
    expect(workCommentToPost(before, item({ phase: "merged", pr: 983, issue: 979 }))).toBeNull();
  });

  it("announces the merge only once", () => {
    const merged = item({ phase: "merged", pr: 983, issue: 979 });
    expect(workCommentToPost(merged, merged)).toBeNull();
  });

  it("says nothing about a cell with no issue", () => {
    expect(workCommentToPost(item(), item({ phase: "ready", pr: 983 }))).toBeNull();
  });

  // Switching a cell to a branch whose PR is already merged is not this cell doing the merge.
  it("does not announce a start for work that is already merged or closed", () => {
    expect(workCommentToPost(item(), item({ phase: "closed", pr: 983, issue: 979 }))).toBeNull();
  });

  it("announces the new issue when a cell moves to a different one", () => {
    const before = item({ phase: "ready", pr: 983, issue: 979 });
    expect(workCommentToPost(before, item({ phase: "none", issue: 966 }))).toBe("start");
  });
});
