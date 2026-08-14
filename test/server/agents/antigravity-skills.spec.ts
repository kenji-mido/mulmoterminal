// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  antigravitySkillsConfigFile,
  mergeAntigravitySkillsConfig,
  syncAntigravitySkillsConfig,
  SKILL_ENTRY_PATHS,
} from "../../../server/agents/antigravity-skills.js";

describe("mergeAntigravitySkillsConfig", () => {
  it("adds both skill roots to an empty config", () => {
    expect(mergeAntigravitySkillsConfig({})).toEqual({ entries: [{ path: ".claude/skills" }, { path: "~/.claude/skills" }] });
  });

  // No write when there is nothing to add: the sync runs on every agy spawn, and rewriting an
  // unchanged file would churn its mtime and normalize the user's formatting each time.
  it("returns null when every root is already present", () => {
    const existing = { entries: SKILL_ENTRY_PATHS.map((p) => ({ path: p })) };
    expect(mergeAntigravitySkillsConfig(existing)).toBeNull();
  });

  it("keeps the user's own entries, appending ours after them", () => {
    const merged = mergeAntigravitySkillsConfig({ entries: [{ path: "tools/agents/skills", exclude: ["wip-.*"] }] });
    expect(merged?.entries).toEqual([{ path: "tools/agents/skills", exclude: ["wip-.*"] }, { path: ".claude/skills" }, { path: "~/.claude/skills" }]);
  });

  it("adds only the root that is missing", () => {
    const merged = mergeAntigravitySkillsConfig({ entries: [{ path: ".claude/skills" }] });
    expect(merged?.entries).toEqual([{ path: ".claude/skills" }, { path: "~/.claude/skills" }]);
  });

  // `inherits` and any field agy grows later ride along untouched — the file is the user's.
  it("preserves fields it does not know", () => {
    const merged = mergeAntigravitySkillsConfig({ inherits: [{ path: "/shared/skills.json" }], future: true });
    expect(merged).toMatchObject({ inherits: [{ path: "/shared/skills.json" }], future: true });
  });

  // An entry we cannot read as {path: string} is left in place but never matched — a malformed
  // entry must not swallow the root we were about to add.
  it("ignores malformed entries when checking presence", () => {
    const merged = mergeAntigravitySkillsConfig({ entries: ["not-an-object", { path: 5 }] });
    expect(merged?.entries).toEqual(["not-an-object", { path: 5 }, { path: ".claude/skills" }, { path: "~/.claude/skills" }]);
  });

  it("refuses a config that is not an object, or whose entries is not an array", () => {
    expect(mergeAntigravitySkillsConfig([])).toBeNull();
    expect(mergeAntigravitySkillsConfig("x")).toBeNull();
    expect(mergeAntigravitySkillsConfig({ entries: { path: ".claude/skills" } })).toBeNull();
  });
});

describe("syncAntigravitySkillsConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-skills-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(antigravitySkillsConfigFile(dir), "utf8"));

  it("writes .agents/skills.json pointing at both skill roots", () => {
    syncAntigravitySkillsConfig(dir);
    expect(read()).toEqual({ entries: [{ path: ".claude/skills" }, { path: "~/.claude/skills" }] });
  });

  it("is idempotent — a second sync leaves the file byte-identical", () => {
    syncAntigravitySkillsConfig(dir);
    const first = fs.readFileSync(antigravitySkillsConfigFile(dir), "utf8");
    syncAntigravitySkillsConfig(dir);
    expect(fs.readFileSync(antigravitySkillsConfigFile(dir), "utf8")).toBe(first);
  });

  it("merges into a user's existing file without losing their entries", () => {
    fs.mkdirSync(path.dirname(antigravitySkillsConfigFile(dir)), { recursive: true });
    fs.writeFileSync(antigravitySkillsConfigFile(dir), JSON.stringify({ entries: [{ path: "~/personal-skills" }] }));
    syncAntigravitySkillsConfig(dir);
    expect(read().entries).toEqual([{ path: "~/personal-skills" }, { path: ".claude/skills" }, { path: "~/.claude/skills" }]);
  });

  // Not JSON means it is not a file we wrote, and rewriting it would lose whatever it is.
  it("leaves an unparseable file untouched", () => {
    fs.mkdirSync(path.dirname(antigravitySkillsConfigFile(dir)), { recursive: true });
    fs.writeFileSync(antigravitySkillsConfigFile(dir), "not json");
    syncAntigravitySkillsConfig(dir);
    expect(fs.readFileSync(antigravitySkillsConfigFile(dir), "utf8")).toBe("not json");
  });

  // A checkout can COMMIT skills.json as a symlink to a file elsewhere; the sync's writes
  // follow links, so without the guard a cloned repo could have a user-owned file silently
  // rewritten on every agy spawn (#1544 review).
  it.skipIf(process.platform === "win32")("refuses to write through a symlinked skills.json", () => {
    const target = path.join(dir, "their-own.json");
    fs.writeFileSync(target, "{}");
    fs.mkdirSync(path.dirname(antigravitySkillsConfigFile(dir)), { recursive: true });
    fs.symlinkSync(target, antigravitySkillsConfigFile(dir));
    syncAntigravitySkillsConfig(dir);
    expect(fs.readFileSync(target, "utf8")).toBe("{}");
  });

  // `.agents` existing as a regular FILE makes the child lstat throw ENOTDIR (`throwIfNoEntry`
  // suppresses only missing entries) — the guard must swallow that and skip, not fail the agy
  // spawn it runs inside (CodeRabbit on #1544).
  it("skips quietly when .agents is a regular file", () => {
    fs.writeFileSync(path.join(dir, ".agents"), "not a directory");
    expect(() => syncAntigravitySkillsConfig(dir)).not.toThrow();
    expect(fs.readFileSync(path.join(dir, ".agents"), "utf8")).toBe("not a directory");
  });

  it.skipIf(process.platform === "win32")("refuses to write through a symlinked .agents directory", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ag-outside-"));
    try {
      fs.symlinkSync(outside, path.join(dir, ".agents"));
      syncAntigravitySkillsConfig(dir);
      expect(fs.readdirSync(outside)).toHaveLength(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // The user's own repo: the file is generated on spawn, so it must not turn up in git status.
  it("excludes the file through .git/info/exclude, not their .gitignore", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    syncAntigravitySkillsConfig(dir);
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toContain(".agents/skills.json");
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
  });
});
