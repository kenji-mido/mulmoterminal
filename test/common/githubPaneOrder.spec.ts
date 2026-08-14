// @vitest-environment node
import { describe, it, expect } from "vitest";

import { leadWithRepo, repoForCwd } from "../../common/githubPaneOrder";

const dirs = (...paths: string[]) => paths.map((path) => ({ path }));

const REPO_DIRS = [
  { repo: "receptron/mulmoterminal", dirs: dirs("/srv/mt", "/srv/mt2") },
  { repo: "receptron/mulmoclaude", dirs: dirs("/srv/mc") },
];

describe("repoForCwd", () => {
  it("finds the repo a registered clone belongs to", () => {
    expect(repoForCwd("/srv/mt", REPO_DIRS)).toBe("receptron/mulmoterminal");
  });

  it("finds it through ANY of that repo's clones, not just the first", () => {
    // Several clones of one repo commonly run side by side here, so the second is not a corner
    // case — it is the worktree the user is actually in.
    expect(repoForCwd("/srv/mt2", REPO_DIRS)).toBe("receptron/mulmoterminal");
  });

  // Codex review: an exact match left every cell that was not sitting at the clone ROOT leading
  // with the wrong repo — and a cell is very often somewhere under it (the user cd'd into `src/`,
  // or it was started there).
  it("finds the repo from a directory INSIDE the clone", () => {
    expect(repoForCwd("/srv/mt/src/components", REPO_DIRS)).toBe("receptron/mulmoterminal");
  });

  it("does not take a mere prefix for containment", () => {
    // `/srv/mt-marketing` starts with `/srv/mt` as a string. The separator is what makes it a
    // boundary — without it a sibling directory borrows its neighbour's repo.
    expect(repoForCwd("/srv/mt-marketing", REPO_DIRS)).toBeNull();
  });

  it("takes the DEEPEST clone when they nest", () => {
    // Clones nest here — a worktree under a repo's managed root, or one repo vendored inside
    // another. The innermost is the repository the cell is actually in.
    const nested = [
      { repo: "outer/one", dirs: dirs("/srv/outer") },
      { repo: "inner/two", dirs: dirs("/srv/outer/vendor/inner") },
    ];
    expect(repoForCwd("/srv/outer/vendor/inner/src", nested)).toBe("inner/two");
    expect(repoForCwd("/srv/outer/src", nested)).toBe("outer/one");
  });

  it("folds a trailing slash, a dot segment and both separators", () => {
    // The browser has no filesystem, so this is what dirPathKey buys: one spelling for the
    // several a path can arrive as.
    expect(repoForCwd("/srv/mt/", REPO_DIRS)).toBe("receptron/mulmoterminal");
    expect(repoForCwd("/srv/mt/./src", REPO_DIRS)).toBe("receptron/mulmoterminal");
    expect(repoForCwd("/srv/mt/src/..", REPO_DIRS)).toBe("receptron/mulmoterminal");
    expect(repoForCwd("\\srv\\mt\\src", [{ repo: "receptron/mulmoterminal", dirs: dirs("\\srv\\mt") }])).toBe("receptron/mulmoterminal");
  });

  it("answers null for a directory nobody registered", () => {
    // The decision this encodes: that cell opens the pane in the conventional order rather than
    // erroring. It is also the mundane explanation for "my repo did not float to the top".
    expect(repoForCwd("/srv/elsewhere", REPO_DIRS)).toBeNull();
  });

  it("answers null with no cwd at all — the cell-less hosts", () => {
    expect(repoForCwd(null, REPO_DIRS)).toBeNull();
    expect(repoForCwd(undefined, REPO_DIRS)).toBeNull();
    expect(repoForCwd("", REPO_DIRS)).toBeNull();
  });

  it("matches a path case-insensitively, as Windows and default macOS do", () => {
    expect(repoForCwd("/SRV/MT", REPO_DIRS)).toBe("receptron/mulmoterminal");
  });

  it("answers null when nothing is registered", () => {
    expect(repoForCwd("/srv/mt", [])).toBeNull();
  });
});

describe("leadWithRepo", () => {
  const rows = [{ repo: "a/one" }, { repo: "b/two" }, { repo: "c/three" }];

  it("moves the named repo to the front, keeping the rest in order", () => {
    expect(leadWithRepo(rows, "c/three").map((r) => r.repo)).toEqual(["c/three", "a/one", "b/two"]);
  });

  it("leaves the order alone when the repo is already first", () => {
    expect(leadWithRepo(rows, "a/one").map((r) => r.repo)).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("leaves the order alone when there is no repo to lead with", () => {
    expect(leadWithRepo(rows, null).map((r) => r.repo)).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("leaves the order alone when the repo has no section", () => {
    // A registered clone whose repo is not among the configured ones: there is nothing to
    // promote, and the list must still render rather than lose a row.
    expect(leadWithRepo(rows, "z/none").map((r) => r.repo)).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("matches the repo case-insensitively, as GitHub does", () => {
    expect(leadWithRepo(rows, "C/Three").map((r) => r.repo)).toEqual(["c/three", "a/one", "b/two"]);
  });

  it("does not mutate its input", () => {
    const original = [...rows];
    leadWithRepo(rows, "c/three");
    expect(rows).toEqual(original);
  });

  it("survives an empty list", () => {
    expect(leadWithRepo([], "a/one")).toEqual([]);
  });
});
