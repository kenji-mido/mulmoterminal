import { describe, it, expect } from "vitest";
import { worktreeLabel, isManagedWorktreePath } from "../../common/worktreePath.js";

describe("worktreeLabel", () => {
  it("extracts <repo> and <task> from a managed worktree path", () => {
    expect(worktreeLabel("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-login")).toEqual({ repo: "myrepo", task: "fix-login" });
  });
  it("keeps a repo name that itself contains dashes", () => {
    expect(worktreeLabel("/x/worktrees/my-cool-repo-deadbeef/task-2")).toEqual({ repo: "my-cool-repo", task: "task-2" });
  });
  it("handles Windows separators", () => {
    expect(worktreeLabel("C:\\Users\\me\\.mulmoterminal\\worktrees\\app-0badf00d\\wip")).toEqual({ repo: "app", task: "wip" });
  });
  it("returns null for non-worktree paths", () => {
    expect(worktreeLabel(null)).toBeNull();
    expect(worktreeLabel("/Users/me/ss/proj")).toBeNull();
    expect(worktreeLabel("/x/worktrees/no-hash-here/task")).toBeNull(); // dir lacks the -<8hex> suffix
    expect(worktreeLabel("/x/worktrees/app-1a2b3c4d")).toBeNull(); // no task segment
  });
});

// A worktree is one branch for one task and is deleted with it, so it is never a directory to
// offer as "launch here again" — and nothing prunes its chip when the directory goes. Both the
// browser's auto-record and `mulmoterminal init`'s seeding ask this, which is why it is here.
describe("isManagedWorktreePath", () => {
  const ROOT = "/Users/me/.mulmoterminal/worktrees";

  it("recognises a worktree under the managed root", () => {
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug", ROOT)).toBe(true);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug/src", ROOT)).toBe(true); // deeper in
  });

  it("recognises one on Windows separators", () => {
    const winRoot = "C:\\Users\\me\\.mulmoterminal\\worktrees";
    expect(isManagedWorktreePath("C:\\Users\\me\\.mulmoterminal\\worktrees\\app-0badf00d\\wip", winRoot)).toBe(true);
  });

  it("leaves an ordinary project alone", () => {
    expect(isManagedWorktreePath("/Users/me/myrepo", ROOT)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/mulmoclaude", ROOT)).toBe(false);
  });

  // The whole reason this is anchored on the ROOT and not on the path's shape: a directory laid out
  // the same way by a person or another tool is a real working directory, and dropping it would
  // silently remove it from the launcher (Codex on #1543).
  it("does not claim a same-shaped path outside the managed root", () => {
    expect(isManagedWorktreePath("/Users/me/dev/worktrees/myrepo-1a2b3c4d/fix-bug", ROOT)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/other-tool/worktrees/app-0badf00d/wip", ROOT)).toBe(false);
  });

  // A sibling whose name merely starts with the root's — the boundary a string prefix would miss.
  it("does not claim a sibling of the root", () => {
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees-backup/myrepo-1a2b3c4d/fix-bug", ROOT)).toBe(false);
  });

  // The root holds worktrees but is not one, and the per-repo directory above a task is not either.
  it("does not claim the levels above a task", () => {
    expect(isManagedWorktreePath(ROOT, ROOT)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d", ROOT)).toBe(false);
  });

  // Under the root, but carrying no hash — so not a directory this app minted. Someone put it
  // there, and it is theirs to launch in (Codex on #1543).
  it("does not claim a hand-made directory under the root", () => {
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo/fix-bug", ROOT)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-zzzzzzzz/fix-bug", ROOT)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/notes/2026/plan", ROOT)).toBe(false);
  });

  // The spellings a person types, folded by dirPathKey — a trailing slash, a `..`.
  it("sees through the spellings of the same directory", () => {
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug/", ROOT)).toBe(true);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/x/../worktrees/myrepo-1a2b3c4d/fix-bug", ROOT)).toBe(true);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug", `${ROOT}/`)).toBe(true);
  });

  // Before /api/config resolves there is nothing to compare against. Of the two ways to be wrong,
  // an extra chip the user can delete beats a directory that quietly never appears.
  it("answers false — record it — when the root is unknown", () => {
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug", null)).toBe(false);
    expect(isManagedWorktreePath("/Users/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-bug", "")).toBe(false);
  });

  it("answers false for an empty cwd", () => {
    expect(isManagedWorktreePath("", ROOT)).toBe(false);
    expect(isManagedWorktreePath(null, ROOT)).toBe(false);
  });
});
