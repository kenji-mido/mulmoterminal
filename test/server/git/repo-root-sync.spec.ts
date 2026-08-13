// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { repoRootSync } from "../../../server/git/repo-root-sync";
import { repoRoot } from "../../../server/git/worktrees";
import { execFileSync } from "node:child_process";

// A real repo with a real linked worktree, so the sync resolver is checked against git itself
// rather than against my idea of what git writes.
let base = "";
let main = "";
let worktree = "";

beforeAll(() => {
  // `.native`, not plain realpathSync: on a Windows runner os.tmpdir() is the 8.3 short form
  // (C:\Users\RUNNER~1\…) and only the native resolver expands it to the long name git reports.
  base = makeTempDir("mt-reporoot-");
  main = path.join(base, "myrepo");
  mkdirSync(main);
  const git = (args: string[], cwd = main) =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", args, { cwd, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.invalid"]);
  git(["config", "user.name", "t"]);
  writeFileSync(path.join(main, "f.txt"), "x");
  git(["add", "f.txt"]);
  git(["commit", "-qm", "first"]);
  worktree = path.join(base, "wt");
  git(["worktree", "add", "-q", "-b", "side", worktree]);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

// git prints POSIX separators even on Windows, and these resolvers return whatever their input
// used, so the two disagree on shape while naming the same directory. Compare the resolved form.
const norm = (p: string | null): string | null => (p === null ? null : path.resolve(p));

describe("repoRootSync", () => {
  it("finds the checkout a directory belongs to", () => {
    expect(norm(repoRootSync(main))).toBe(norm(main));
    const nested = path.join(main, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(norm(repoRootSync(nested))).toBe(norm(main));
  });

  // The point of the whole thing: from inside a linked worktree the answer is the MAIN
  // checkout, because that is what names the clone (the branch is already on the PR).
  it("answers with the main checkout from inside a linked worktree", () => {
    expect(norm(repoRootSync(worktree))).toBe(norm(main));
  });

  it("agrees with the async resolver the rest of the server uses", async () => {
    expect(norm(repoRootSync(main))).toBe(norm(await repoRoot(main)));
    expect(norm(repoRootSync(worktree))).toBe(norm(await repoRoot(worktree)));
  });

  it("returns null outside a repository", () => {
    const plain = makeTempDir("mt-norepo-");
    expect(repoRootSync(plain)).toBeNull();
    rmSync(plain, { recursive: true, force: true });
  });

  it("returns null for a .git file it cannot make sense of", () => {
    const odd = path.join(base, "odd");
    mkdirSync(odd);
    writeFileSync(path.join(odd, ".git"), "not a gitdir line");
    expect(repoRootSync(odd)).toBeNull();
  });
});
