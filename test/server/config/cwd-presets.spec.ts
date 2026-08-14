// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizePresets, loadPresets, savePresets, extractCwdFromTranscript, deriveCwdPresets } from "../../../server/config/cwd-presets";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-presets-"));

describe("sanitizePresets", () => {
  // Expectations built through `path`, not written as POSIX literals: paths are canonicalized
  // now, and on Windows `/a` is drive-relative — it resolves to `C:\a`, not `/a`.
  it("keeps valid {label,path}, trims, and drops incomplete/junk rows", () => {
    expect(sanitizePresets([{ label: " a ", path: " /a " }, { label: "", path: "/b" }, { label: "c", path: "" }, { nope: 1 }, "x"])).toEqual([
      { label: "a", path: path.resolve("/a") },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(sanitizePresets(null)).toEqual([]);
    expect(sanitizePresets({ cwdPresets: [] })).toEqual([]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: `l${i}`, path: `/p${i}` }));
    expect(sanitizePresets(many, 50)).toHaveLength(50);
  });
});

describe("savePresets / loadPresets", () => {
  it("round-trips through a file", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json"); // nested → mkdir is exercised
    expect(savePresets(file, [{ label: "x", path: "/x" }])).toBe(true);
    // savePresets writes what it is given; canonicalisation happens on the way back IN
    // (sanitizePresets, #1002). So the file keeps the literal, and only the load is resolved —
    // which on Windows is where `/x` picks up the current drive.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ cwdPresets: [{ label: "x", path: "/x" }] });
    expect(loadPresets(file)).toEqual([{ label: "x", path: path.resolve("/x") }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadPresets returns [] for a missing or invalid file", () => {
    const dir = tmp();
    expect(loadPresets(path.join(dir, "none.json"))).toEqual([]);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "not json{");
    expect(loadPresets(bad)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("savePresets returns false when the path can't be written (regression for the 500 path)", () => {
    const dir = tmp();
    const asFile = path.join(dir, "afile");
    writeFileSync(asFile, "x"); // a file where a directory is needed
    // mkdir(`<file>/sub`) fails because the parent is a file → save reports false.
    expect(savePresets(path.join(asFile, "sub", "config.json"), [{ label: "x", path: "/x" }])).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("extractCwdFromTranscript", () => {
  it("returns the first cwd found across JSONL lines", () => {
    const raw = ['{"type":"summary"}', '{"cwd":"/Users/me/proj","role":"user"}', '{"cwd":"/other"}'].join("\n");
    expect(extractCwdFromTranscript(raw)).toBe("/Users/me/proj");
  });

  it("skips blank / non-JSON / partial lines", () => {
    expect(extractCwdFromTranscript(["", "not json {", '{"role":"user"}', '{"cwd":"/p"}'].join("\n"))).toBe("/p");
  });

  it("returns null when no line carries a cwd", () => {
    expect(extractCwdFromTranscript('{"a":1}\n{"b":2}')).toBeNull();
    expect(extractCwdFromTranscript("")).toBeNull();
  });
});

describe("deriveCwdPresets", () => {
  const exists = (p: string) => p !== "/gone";

  it("keeps existing dirs, newest first, deduped by path, capped", () => {
    const records = [
      { cwd: "/a", mtimeMs: 100 },
      { cwd: "/b", mtimeMs: 300 },
      { cwd: "/a", mtimeMs: 200 }, // newer duplicate of /a
      { cwd: "/gone", mtimeMs: 999 }, // filtered — doesn't exist
      { cwd: "/c", mtimeMs: 50 },
    ];
    expect(deriveCwdPresets(records, exists, 2)).toEqual([
      { label: "b", path: "/b" }, // 300
      { label: "a", path: "/a" }, // duplicate collapsed to its newest (200)
    ]);
  });

  // The second door onto the same list: `mulmoterminal init` seeds it from Claude's history, and a
  // session run inside a worktree would put that task branch among the user's real projects — the
  // browser's auto-record already refuses it, and both ask the one predicate in common/.
  //
  // The root is passed in rather than taken from MULMOTERMINAL_HOME, so this pins the rule without
  // depending on where the test process thinks home is.
  const WORKTREES_ROOT = "/home/me/.mulmoterminal/worktrees";

  it("drops a managed worktree, keeping the repository it came from", () => {
    const records = [
      { cwd: "/home/me/myrepo", mtimeMs: 100 },
      { cwd: `${WORKTREES_ROOT}/myrepo-1a2b3c4d/fix-bug`, mtimeMs: 300 },
    ];
    expect(deriveCwdPresets(records, () => true, 10, WORKTREES_ROOT)).toEqual([{ label: "myrepo", path: "/home/me/myrepo" }]);
  });

  // Anchored on the root, so a directory laid out the same way somewhere else stays a real working
  // directory (Codex on #1543).
  it("keeps a same-shaped directory outside the managed root", () => {
    const outside = "/home/me/dev/worktrees/myrepo-1a2b3c4d/fix-bug";
    expect(deriveCwdPresets([{ cwd: outside, mtimeMs: 1 }], () => true, 10, WORKTREES_ROOT)).toEqual([{ label: "fix-bug", path: outside }]);
  });

  it("labels with the trailing segment (handles hyphenated dir names)", () => {
    expect(deriveCwdPresets([{ cwd: "/x/my-app", mtimeMs: 1 }], () => true)).toEqual([{ label: "my-app", path: "/x/my-app" }]);
  });

  it("is empty when nothing exists", () => {
    expect(deriveCwdPresets([{ cwd: "/gone", mtimeMs: 1 }], () => false)).toEqual([]);
  });
});

// #1002. The launcher chips are matched by exact path string (useAppConfig's recordPreset), and
// the cwd handed to it is the SERVER-confirmed one — now canonical. A stored `/a/b/` would then
// never match, so relaunching that directory prepended a second chip for it instead of moving
// the existing one to the front.
describe("sanitizePresets — one spelling per directory", () => {
  const dir = path.resolve("/Users/me/proj");

  it("canonicalizes a trailing separator, so it matches the cwd the server reports", () => {
    expect(sanitizePresets([{ label: "proj", path: dir + path.sep }])).toEqual([{ label: "proj", path: dir }]);
  });

  it("collapses two spellings of one directory into a single chip", () => {
    const presets = sanitizePresets([
      { label: "newest", path: dir },
      { label: "older", path: dir + path.sep },
    ]);
    expect(presets).toEqual([{ label: "newest", path: dir }]);
  });

  // The list is most-recently-used order, and a user may have renamed the chip they kept.
  it("keeps the FIRST of the duplicates, label and all", () => {
    const presets = sanitizePresets([
      { label: "My Project", path: dir + path.sep },
      { label: "proj", path: dir },
    ]);
    expect(presets).toEqual([{ label: "My Project", path: dir }]);
  });

  it("collapses . and .. rather than storing a path that only looks different", () => {
    expect(sanitizePresets([{ label: "p", path: path.join(dir, "sub", "..") }])).toEqual([{ label: "p", path: dir }]);
  });

  // path.resolve on a relative string would splice it onto the SERVER's cwd and invent a
  // directory the user never named. Such an entry can't launch anyway — the workspace guard
  // rejects it — so it is kept exactly as written instead of being silently repointed.
  it("leaves a relative path alone instead of resolving it against the server's cwd", () => {
    expect(sanitizePresets([{ label: "rel", path: "some/where" }])).toEqual([{ label: "rel", path: "some/where" }]);
  });

  it("still caps the count after deduping", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ label: `p${i}`, path: path.resolve(`/tmp/p${i}`) }));
    expect(sanitizePresets([...many, ...many], 3)).toHaveLength(3);
  });
});
