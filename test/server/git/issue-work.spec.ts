// Starting work on an issue: what the seed says, and that a failed step stops rather than
// leaving half the work behind.
import { describe, it, expect, vi } from "vitest";
import { issueSeedPrompt, startIssueWork, type IssueDetail } from "../../../server/git/issue-work.js";

const issue = (over: Partial<IssueDetail> = {}): IssueDetail => ({
  number: 1173,
  title: "Start from the issue row",
  body: "The list is read-only today.",
  ...over,
});

describe("issueSeedPrompt", () => {
  it("names the issue and links it before quoting the body", () => {
    const seed = issueSeedPrompt("acme/web", issue());
    expect(seed).toContain("GitHub issue #1173: Start from the issue row");
    expect(seed).toContain("https://github.com/acme/web/issues/1173");
    expect(seed).toContain("The list is read-only today.");
    // The number has to be IN the text: the body alone does not say which issue this is, and the
    // agent needs it to comment, to read the discussion and to write the PR.
    expect(seed.indexOf("#1173")).toBeLessThan(seed.indexOf("The list is read-only"));
  });

  // An issue whose brief is entirely in its title is normal, and must not produce a seed with a
  // blank quoted section where the body would be.
  it("skips the body section when the issue has none", () => {
    const seed = issueSeedPrompt("acme/web", issue({ body: "   " }));
    expect(seed).toContain("GitHub issue #1173");
    expect(seed).not.toMatch(/\n\n\n/);
  });
});

describe("startIssueWork", () => {
  const spawnDraft = vi.fn(() => "session-1");
  const deps = (over: Partial<Parameters<typeof startIssueWork>[3]> = {}) => {
    spawnDraft.mockClear();
    return {
      fetchIssue: () => Promise.resolve(issue()),
      makeWorktree: () => Promise.resolve({ path: "/wt/1173-start", branch: "issue/1173-start" }),
      spawnDraft,
      ...over,
    };
  };

  it("reads the issue, cuts its worktree, and seeds the session in it", async () => {
    const result = await startIssueWork("acme/web", 1173, "/w/repo", deps());
    expect(result).toMatchObject({ ok: true, sessionId: "session-1", worktree: "/wt/1173-start", branch: "issue/1173-start" });
    // The seed goes into the WORKTREE, not the clone it was cut from.
    expect(spawnDraft).toHaveBeenCalledWith("/wt/1173-start", expect.stringContaining("GitHub issue #1173"));
  });

  it("passes the issue title to the worktree, so the branch reads as the work", async () => {
    const makeWorktree = vi.fn(() => Promise.resolve({ path: "/wt/x", branch: "issue/1173-x" }));
    await startIssueWork("acme/web", 1173, "/w/repo", deps({ makeWorktree }));
    expect(makeWorktree).toHaveBeenCalledWith("/w/repo", "Start from the issue row", 1173);
  });

  // Each failure stops BEFORE the next step: an unreadable issue must not cut a branch, and a
  // worktree that could not be created must not leave a session running in the wrong directory.
  it("does not cut a worktree when the issue cannot be read", async () => {
    const makeWorktree = vi.fn(() => Promise.resolve({ path: "/wt/x", branch: "b" }));
    const result = await startIssueWork("acme/web", 1173, "/w/repo", deps({ fetchIssue: () => Promise.resolve(null), makeWorktree }));
    expect(result).toMatchObject({ ok: false, reason: "issue-not-found" });
    expect(makeWorktree).not.toHaveBeenCalled();
    expect(spawnDraft).not.toHaveBeenCalled();
  });

  it("does not spawn when the worktree could not be created", async () => {
    const result = await startIssueWork("acme/web", 1173, "/w/repo", deps({ makeWorktree: () => Promise.resolve(null) }));
    expect(result).toMatchObject({ ok: false, reason: "worktree-failed" });
    expect(spawnDraft).not.toHaveBeenCalled();
  });
});
