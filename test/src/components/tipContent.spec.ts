// What each cell-header chip says on hover (#1235). The interesting cases are the absences: a
// section with a heading and nothing under it is worse than no section, and it is what a naive
// builder produces for a PR whose title has not been fetched.
import { describe, it, expect } from "vitest";
import { badgeTip, gitTip, textTip, workTip } from "../../../src/components/tipContent";
import { EMPTY_WORK_ITEM, type WorkItem } from "../../../common/prPhase";
import type { GitStatus } from "../../../common/gitStatus";

const work = (over: Partial<WorkItem>): WorkItem => ({ ...EMPTY_WORK_ITEM, ...over });
const git = (over: Partial<GitStatus>): GitStatus =>
  ({ repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: true, ...over }) as GitStatus;

describe("workTip", () => {
  // The point of the whole change: these titles have been arriving since #1014 and the desktop
  // showed neither of them, so the header could say `#2689 → #2688` and you still had to open
  // GitHub to learn which request that was.
  it("names the PR and the issue in words, not just numbers", () => {
    const tip = workTip(work({ phase: "ci-running", pr: 2689, prTitle: "経路A/Bの分離実装", issue: 2688, issueTitle: "セッション復元が2経路に分かれている" }));
    expect(tip).toEqual([
      { head: "PR #2689 · CI running", note: "経路A/Bの分離実装" },
      { head: "issue #2688", note: "セッション復元が2経路に分かれている" },
    ]);
  });

  it("drops the note when nobody could tell us the title", () => {
    expect(workTip(work({ phase: "ready", pr: 977 }))).toEqual([{ head: "PR #977 · ready to merge" }]);
  });

  it("shows the issue alone before a PR exists", () => {
    expect(workTip(work({ phase: "none", issue: 979, issueTitle: "work item" }))).toEqual([{ head: "issue #979", note: "work item" }]);
  });

  // Nothing to describe: the tip layer reads an empty list as "do not open", so a chip whose poll
  // has not answered yet stays silent rather than flashing an empty box.
  it("says nothing when there is neither", () => {
    expect(workTip(work({}))).toEqual([]);
  });
});

describe("gitTip", () => {
  it("gives the branch its own line, then the counts", () => {
    expect(gitTip(git({ branch: "fix/1235-instant-header-tips", dirty: 2, ahead: 1 }))).toEqual([
      { head: "branch fix/1235-instant-header-tips" },
      { head: "2 uncommitted · 1 ahead" },
    ]);
  });

  it("omits the counts line when the tree is clean and level", () => {
    expect(gitTip(git({}))).toEqual([{ head: "branch main" }]);
  });

  // Ahead/behind against no upstream is not a fact, so it must not be stated — the same rule the
  // chip itself follows.
  it("ignores ahead/behind with no upstream", () => {
    expect(gitTip(git({ upstream: false, ahead: 3, behind: 2, dirty: 1 }))).toEqual([{ head: "branch main" }, { head: "1 uncommitted" }]);
  });

  it("says detached rather than naming a branch", () => {
    expect(gitTip(git({ detached: true, branch: null }))).toEqual([{ head: "detached HEAD" }]);
  });

  it("says nothing outside a repo", () => {
    expect(gitTip(null)).toEqual([]);
    expect(gitTip(git({ repo: false }))).toEqual([]);
  });
});

describe("badgeTip", () => {
  it("splits the model from its context reading, so neither shares a line", () => {
    expect(badgeTip("Claude · claude-opus-4 · context 70,000 / 200,000 (35%) tokens")).toEqual([
      { head: "Claude" },
      { head: "claude-opus-4" },
      { head: "context 70,000 / 200,000 (35%) tokens" },
    ]);
  });

  it("says nothing when there is no badge to describe", () => {
    expect(badgeTip("")).toEqual([]);
  });
});

describe("textTip", () => {
  it("carries one line", () => {
    expect(textTip("/Users/x/ss/llm/mulmoterminal6")).toEqual([{ head: "/Users/x/ss/llm/mulmoterminal6" }]);
  });

  it.each([null, undefined, "", "   "])("says nothing for %p", (value) => {
    expect(textTip(value)).toEqual([]);
  });
});
