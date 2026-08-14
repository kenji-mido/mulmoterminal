// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { excludeFromGit } from "../../../server/agents/git-exclude.js";

describe("excludeFromGit", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-exclude-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("appends the entry to a plain checkout's .git/info/exclude", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    excludeFromGit(dir, ".agents/skills.json");
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toBe(".agents/skills.json\n");
  });

  // A linked worktree keeps `.git` as a file naming its private gitdir, and git reads excludes
  // from the COMMON dir its `commondir` file points to — the per-worktree info/exclude is
  // ignored (measured; see git-exclude.ts). Before this resolution existed, every agy spawn in
  // a worktree left `?? .agents/` in git status, which the worktree-removal flow then read as
  // uncommitted work (#1544 review).
  it("resolves a worktree's .git file to the common dir's info/exclude", () => {
    const main = path.join(dir, "main");
    const wt = path.join(dir, "wt");
    const gitdir = path.join(main, ".git", "worktrees", "wt");
    fs.mkdirSync(path.join(main, ".git", "info"), { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${gitdir}\n`);

    excludeFromGit(wt, ".agents/skills.json");

    expect(fs.readFileSync(path.join(main, ".git", "info", "exclude"), "utf8")).toBe(".agents/skills.json\n");
    // Nothing lands in the per-worktree gitdir, which git would ignore anyway.
    expect(fs.existsSync(path.join(gitdir, "info", "exclude"))).toBe(false);
  });

  // A worktree's `.git` file names the gitdir RELATIVE when the tools that made it did — the
  // resolution has to happen against the worktree, not the process cwd.
  it("resolves a relative gitdir in the .git file", () => {
    const main = path.join(dir, "main");
    const wt = path.join(dir, "wt");
    const gitdir = path.join(main, ".git", "worktrees", "wt");
    fs.mkdirSync(path.join(main, ".git", "info"), { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, ".git"), "gitdir: ../main/.git/worktrees/wt\n");

    excludeFromGit(wt, ".agents/skills.json");

    expect(fs.readFileSync(path.join(main, ".git", "info", "exclude"), "utf8")).toBe(".agents/skills.json\n");
  });

  // A submodule's gitdir (under the superproject's .git/modules/) has no commondir file and IS
  // the dir git reads.
  it("resolves a submodule's .git file to its own gitdir", () => {
    const gitdir = path.join(dir, "super", ".git", "modules", "sub");
    const sub = path.join(dir, "super", "sub");
    fs.mkdirSync(path.join(gitdir, "info"), { recursive: true });
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, ".git"), `gitdir: ${gitdir}\n`);

    excludeFromGit(sub, ".agents/skills.json");

    expect(fs.readFileSync(path.join(gitdir, "info", "exclude"), "utf8")).toBe(".agents/skills.json\n");
  });

  it("does nothing where there is no .git at all", () => {
    excludeFromGit(dir, ".agents/skills.json");
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("does not add the same entry twice", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    excludeFromGit(dir, ".agents/skills.json");
    excludeFromGit(dir, ".agents/skills.json");
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toBe(".agents/skills.json\n");
  });
});
