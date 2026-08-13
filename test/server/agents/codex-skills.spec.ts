// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncCodexSkills, codexifySkillSeed } from "../../../server/agents/codex-skills.js";

describe("codexifySkillSeed", () => {
  it("rewrites a /<slug> <msg> chat seed to name the skill in natural language", () => {
    expect(codexifySkillSeed("/art-exhibitions はろー")).toBe('Use the "art-exhibitions" skill.\n\nはろー');
  });
  it("handles a slug with no message", () => {
    expect(codexifySkillSeed("/books")).toBe('Use the "books" skill.');
  });
  it("preserves the record id + message in the rest", () => {
    expect(codexifySkillSeed("/movies id=42 mark as seen")).toBe('Use the "movies" skill.\n\nid=42 mark as seen');
  });
  it("leaves a non-slash prompt unchanged (a collection action's natural-language seed)", () => {
    expect(codexifySkillSeed("Repair this record's fields")).toBe("Repair this record's fields");
  });
});

describe("syncCodexSkills", () => {
  let src: string;
  let dst: string;
  const skillDir = (root: string, name: string): string => path.join(root, name);
  function writeSkill(root: string, name: string, body: string): void {
    mkdirSync(skillDir(root, name), { recursive: true });
    writeFileSync(path.join(skillDir(root, name), "SKILL.md"), body);
  }
  beforeEach(() => {
    src = mkdtempSync(path.join(tmpdir(), "mt-skills-src-"));
    dst = mkdtempSync(path.join(tmpdir(), "mt-skills-dst-"));
  });
  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  });

  it("mirrors workspace skills into the codex dir with an ownership marker", () => {
    writeSkill(src, "art-exhibitions", "# skill");
    const res = syncCodexSkills(src, dst);
    expect(res.mirrored).toEqual(["art-exhibitions"]);
    expect(existsSync(path.join(dst, "art-exhibitions", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dst, "art-exhibitions", ".mt-mirror"))).toBe(true);
  });

  it("does NOT clobber a codex-owned skill of the same name (no marker)", () => {
    writeSkill(src, "wrangler", "# ours");
    writeSkill(dst, "wrangler", "# codex original"); // pre-existing, unmarked = codex's own
    const res = syncCodexSkills(src, dst);
    expect(res.skipped).toEqual(["wrangler"]);
    expect(readFileSync(path.join(dst, "wrangler", "SKILL.md"), "utf8")).toBe("# codex original");
  });

  it("re-copies a previously-mirrored skill (drops files removed from source)", () => {
    writeSkill(src, "books", "# v2");
    // simulate a prior mirror: marked dir with a stale extra file
    mkdirSync(path.join(dst, "books"), { recursive: true });
    writeFileSync(path.join(dst, "books", ".mt-mirror"), "x");
    writeFileSync(path.join(dst, "books", "stale.txt"), "old");
    const res = syncCodexSkills(src, dst);
    expect(res.mirrored).toEqual(["books"]);
    expect(readFileSync(path.join(dst, "books", "SKILL.md"), "utf8")).toBe("# v2");
    expect(existsSync(path.join(dst, "books", "stale.txt"))).toBe(false);
  });

  // Flagged by Codex on #821: when the mirror cannot be removed, copying ON TOP of it leaves
  // whatever the source has since deleted in place — a stale skill codex keeps loading —
  // while the sync reports success. It must skip and say so instead.
  //
  // Windows is where an unremovable directory actually happens (another process holding it),
  // and is also where chmod cannot produce one, so the case is driven the POSIX way.
  it.skipIf(process.platform === "win32")("skips a mirror it could not replace, rather than overlaying it", () => {
    writeSkill(src, "books", "# v2");
    writeFileSync(path.join(src, "books", "only-in-source.md"), "new");
    mkdirSync(path.join(dst, "books"), { recursive: true });
    writeFileSync(path.join(dst, "books", ".mt-mirror"), "x");
    writeFileSync(path.join(dst, "books", "stale.txt"), "old");
    chmodSync(dst, 0o500); // read+execute: the child cannot be unlinked
    try {
      const res = syncCodexSkills(src, dst);
      expect(res.mirrored).toEqual([]);
      expect(res.skipped).toEqual(["books"]);
      // The new source was NOT laid on top: what makes the overlay dangerous is a mirror that
      // looks synced while holding whatever the source deleted. (The directory itself may be
      // partially emptied — rmSync removes contents before it fails on the directory — so the
      // assertion is on what did NOT arrive, which is the part that matters.)
      // A file only the new copy could bring — asserting on one that exists in both would
      // depend on how far rmSync got before failing, which differs between machines.
      expect(existsSync(path.join(dst, "books", "only-in-source.md"))).toBe(false);
    } finally {
      chmodSync(dst, 0o700);
    }
  });

  it("no-ops when the source doesn't exist", () => {
    expect(syncCodexSkills(path.join(src, "nope"), dst)).toEqual({ mirrored: [], skipped: [], removed: [] });
  });

  // Regression (#742): a skill removed from the workspace must be un-mirrored from codex,
  // or codex keeps auto-loading a deleted skill's SKILL.md forever.
  it("removes a mirror we own once its source skill is gone", () => {
    writeSkill(src, "keep-me", "# still here");
    // A prior mirror whose source has since been deleted (marked = ours).
    mkdirSync(path.join(dst, "gone"), { recursive: true });
    writeFileSync(path.join(dst, "gone", ".mt-mirror"), "x");
    writeFileSync(path.join(dst, "gone", "SKILL.md"), "# deleted upstream");
    const res = syncCodexSkills(src, dst);
    expect(res.mirrored).toEqual(["keep-me"]);
    expect(res.removed).toEqual(["gone"]);
    expect(existsSync(path.join(dst, "gone"))).toBe(false);
    expect(existsSync(path.join(dst, "keep-me", "SKILL.md"))).toBe(true);
  });

  it("never removes a codex-owned skill (no marker), only our orphaned mirrors", () => {
    writeSkill(dst, "codex-native", "# codex's own"); // unmarked
    const res = syncCodexSkills(src, dst); // empty source, but dst exists
    expect(res.removed).toEqual([]);
    expect(readFileSync(path.join(dst, "codex-native", "SKILL.md"), "utf8")).toBe("# codex's own");
  });

  it("removes every orphaned mirror when the source dir is gone entirely", () => {
    mkdirSync(path.join(dst, "orphan"), { recursive: true });
    writeFileSync(path.join(dst, "orphan", ".mt-mirror"), "x");
    writeSkill(dst, "codex-native", "# keep"); // unmarked — codex's own
    const res = syncCodexSkills(path.join(src, "nope"), dst);
    expect(res.removed).toEqual(["orphan"]);
    expect(existsSync(path.join(dst, "orphan"))).toBe(false);
    expect(existsSync(path.join(dst, "codex-native"))).toBe(true);
  });
});
