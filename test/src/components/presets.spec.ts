import { describe, it, expect } from "vitest";
import { presetLabel, launchChips, WORKSPACE_LABEL } from "../../../src/components/presets.js";

describe("presetLabel", () => {
  it("uses the trailing path segment (basename)", () => {
    expect(presetLabel("/home/me/my-project")).toBe("my-project");
    expect(presetLabel("/home/me/my-project/")).toBe("my-project"); // ignores a trailing slash
  });

  it("labels a managed worktree as 'repo (task)'", () => {
    expect(presetLabel("/home/me/worktrees/myrepo-1a2b3c4d/fix-bug")).toBe("myrepo (fix-bug)");
  });

  it("handles a Windows-style path", () => {
    expect(presetLabel("C:\\work\\proj")).toBe("proj");
  });
});

// The workspace is the one directory where a session reaches every GUI tool (carriesFullGuiMcp on
// the server), and the launcher used to show it only if the user happened to have launched there —
// the list is auto-recorded, and the chip's own close button could remove it.
describe("launchChips", () => {
  const preset = (path: string) => ({ label: presetLabel(path), path });

  it("offers the workspace even when nothing has been recorded", () => {
    expect(launchChips([], "/home/me/mulmoclaude")).toEqual([{ label: WORKSPACE_LABEL, path: "/home/me/mulmoclaude", isWorkspace: true }]);
  });

  it("puts it first, ahead of the priority ordering the rest arrive in", () => {
    const chips = launchChips([preset("/a/one"), preset("/b/two")], "/home/me/ws");
    expect(chips.map((c) => c.label)).toEqual([WORKSPACE_LABEL, "one", "two"]);
    expect(chips.filter((c) => c.isWorkspace)).toHaveLength(1);
  });

  // Once, not twice — and marked, so the chip that IS the workspace never renders as an ordinary
  // recent directory just because the user has also launched there.
  it("does not duplicate a workspace that is also a recorded preset", () => {
    const chips = launchChips([preset("/a/one"), preset("/home/me/ws")], "/home/me/ws");
    expect(chips.map((c) => c.path)).toEqual(["/home/me/ws", "/a/one"]);
    expect(chips[0]?.isWorkspace).toBe(true);
  });

  // Same lexical folding the worktree rows use (isSameDirPath): a trailing slash or a `..` is a
  // spelling, not another directory. Getting this wrong would show the workspace twice.
  it("folds the spellings of the same directory a person types", () => {
    expect(launchChips([preset("/home/me/ws/")], "/home/me/ws")).toHaveLength(1);
    expect(launchChips([preset("/home/me/x/../ws")], "/home/me/ws")).toHaveLength(1);
  });

  // Named by its ROLE, not by its directory — and that wins over a label the user gave the same
  // path as a recent dir, because on this chip the role is the thing worth saying. The path is
  // still the hover.
  it("labels it WORKSPACE even when the same path is a recorded preset", () => {
    expect(launchChips([{ label: "My Hub", path: "/home/me/ws" }], "/home/me/ws")[0]?.label).toBe("WORKSPACE");
  });

  // Before /api/config resolves there is no workspace to offer, and inventing one would point a
  // click at a directory nobody chose.
  it("offers nothing extra until the server has said where the workspace is", () => {
    expect(launchChips([preset("/a/one")], null)).toEqual([{ label: "one", path: "/a/one", isWorkspace: false }]);
  });
});
