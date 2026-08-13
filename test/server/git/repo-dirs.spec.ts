// The reverse lookup: given `owner/repo`, which local clones can work on it, in what order, and
// which one was chosen. Several clones of one repo run side by side in real setups, so almost
// every case here is about a repo with more than one candidate.
import { describe, it, expect, beforeEach } from "vitest";
import { repoDirsFromPresets, clearRepoDirsCache, type RepoDirsDeps } from "../../../server/git/repo-dirs.js";
import type { CwdPreset } from "../../../server/config/config-schema.js";

const preset = (label: string, path: string): CwdPreset => ({ label, path });

// A fake remote resolver keyed by path, plus a call counter so the cache can be observed.
function fakeRepos(map: Record<string, string | null>) {
  const calls: string[] = [];
  const repoOf = (dir: string): Promise<string | null> => {
    calls.push(dir);
    return Promise.resolve(map[dir] ?? null);
  };
  return { repoOf, calls };
}

// No directory declares a priority unless a case says so — the real reader parses
// `.mulmoterminal.json`, which these paths do not have.
const noPriorities = (): number | null => null;

const deps = (over: Partial<RepoDirsDeps> = {}): RepoDirsDeps => ({ priorityOf: noPriorities, ...over });

beforeEach(() => {
  clearRepoDirsCache();
});

describe("repoDirsFromPresets", () => {
  it("groups several clones of one repo under it", async () => {
    const { repoOf } = fakeRepos({ "/w/mt": "receptron/mulmoterminal", "/w/mt2": "receptron/mulmoterminal", "/w/other": "receptron/mulmoserver" });
    const result = await repoDirsFromPresets([preset("mt", "/w/mt"), preset("mt2", "/w/mt2"), preset("other", "/w/other")], {}, deps({ repoOf }));

    expect(result.map((r) => r.repo)).toEqual(["receptron/mulmoserver", "receptron/mulmoterminal"]);
    expect(result[1].dirs.map((d) => d.path)).toEqual(["/w/mt", "/w/mt2"]);
    expect(result[1].dirs[0]).toEqual({ path: "/w/mt", label: "mt", orderPriority: null });
  });

  // A directory that is not a git repo, has no origin, or whose origin is not GitHub — all
  // ordinary entries in a real preset list, and none of them an error.
  it("drops directories that resolve to no GitHub repo", async () => {
    const { repoOf } = fakeRepos({ "/w/mt": "receptron/mulmoterminal", "/w/plain": null, "/w/gitlab": null });
    const result = await repoDirsFromPresets([preset("mt", "/w/mt"), preset("plain", "/w/plain"), preset("gl", "/w/gitlab")], {}, deps({ repoOf }));

    expect(result).toHaveLength(1);
    expect(result[0].dirs.map((d) => d.path)).toEqual(["/w/mt"]);
  });

  // A repo the user watches but has never cloned simply has no entry. The caller reads absence as
  // "cannot start work here", which is the truth and is what disables the button in the UI.
  it("has no entry at all for a repo with no clone", async () => {
    const { repoOf } = fakeRepos({ "/w/mt": "receptron/mulmoterminal" });
    const result = await repoDirsFromPresets([preset("mt", "/w/mt")], {}, deps({ repoOf }));
    expect(result.find((r) => r.repo === "receptron/graphai")).toBeUndefined();
  });

  describe("ordering", () => {
    it("puts declared priorities first, in order, and the rest by path", async () => {
      const { repoOf } = fakeRepos({ "/w/d": "o/r", "/w/a": "o/r", "/w/c": "o/r", "/w/b": "o/r" });
      const priorityOf = (dir: string): number | null => ({ "/w/d": 20, "/w/c": 30 })[dir] ?? null;
      const result = await repoDirsFromPresets(
        [preset("d", "/w/d"), preset("a", "/w/a"), preset("c", "/w/c"), preset("b", "/w/b")],
        {},
        deps({ repoOf, priorityOf }),
      );

      // 20 then 30, then the two that declare none — by path, not by the order Settings held them.
      expect(result[0].dirs.map((d) => d.path)).toEqual(["/w/d", "/w/c", "/w/a", "/w/b"]);
    });

    it("falls back to path order when nothing declares a priority", async () => {
      const { repoOf } = fakeRepos({ "/w/mt3": "o/r", "/w/mt": "o/r", "/w/mt2": "o/r" });
      const result = await repoDirsFromPresets([preset("mt3", "/w/mt3"), preset("mt", "/w/mt"), preset("mt2", "/w/mt2")], {}, deps({ repoOf }));
      expect(result[0].dirs.map((d) => d.path)).toEqual(["/w/mt", "/w/mt2", "/w/mt3"]);
    });

    it("carries each directory's declared priority through to the caller", async () => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt")], {}, deps({ repoOf, priorityOf: () => 50 }));
      expect(result[0].dirs[0].orderPriority).toBe(50);
    });
  });

  describe("the recorded choice", () => {
    it("is honoured when it still names a clone of that repo", async () => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r", "/w/mt2": "o/r" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt"), preset("mt2", "/w/mt2")], { "o/r": "/w/mt2" }, deps({ repoOf }));
      expect(result[0].primary).toBe("/w/mt2");
    });

    it("is null when the repo has no recording", async () => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt")], {}, deps({ repoOf }));
      expect(result[0].primary).toBeNull();
    });

    // Both of these would otherwise send the next session's work into the wrong tree, and
    // silently — nothing in the UI shows what was recorded.
    it("is dropped when the recorded directory is no longer a saved clone", async () => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt")], { "o/r": "/w/deleted" }, deps({ repoOf }));
      expect(result[0].primary).toBeNull();
    });

    // The recording is keyed by whatever the UI had — which comes from the hand-typed `prRepos` —
    // while the entry's own name is derived from the remote URL. GitHub treats the two spellings as
    // one repository, so an exact-key lookup made a saved choice never stick (Codex review).
    it.each([
      ["Owner/Repo cased differently", "O/R"],
      ["all caps", "O/R".toUpperCase()],
    ])("is honoured when recorded under %s", async (_case, key) => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r", "/w/mt2": "o/r" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt"), preset("mt2", "/w/mt2")], { [key]: "/w/mt2" }, deps({ repoOf }));
      expect(result[0].primary).toBe("/w/mt2");
    });

    it("is dropped when the recorded directory now clones a different repo", async () => {
      const { repoOf } = fakeRepos({ "/w/mt": "o/r", "/w/moved": "other/project" });
      const result = await repoDirsFromPresets([preset("mt", "/w/mt"), preset("moved", "/w/moved")], { "o/r": "/w/moved" }, deps({ repoOf }));
      expect(result[0].primary).toBeNull();
      expect(result.find((r) => r.repo === "other/project")?.primary).toBeNull();
    });
  });

  describe("caching", () => {
    it("resolves each directory once within the window", async () => {
      const { repoOf, calls } = fakeRepos({ "/w/mt": "o/r" });
      const shared = deps({ repoOf, now: () => 1000, ttlMs: 60_000 });
      await repoDirsFromPresets([preset("mt", "/w/mt")], {}, shared);
      await repoDirsFromPresets([preset("mt", "/w/mt")], {}, shared);
      expect(calls).toEqual(["/w/mt"]);
    });

    it("re-resolves once the window has passed", async () => {
      const { repoOf, calls } = fakeRepos({ "/w/mt": "o/r" });
      await repoDirsFromPresets([preset("mt", "/w/mt")], {}, deps({ repoOf, now: () => 1000, ttlMs: 60_000 }));
      await repoDirsFromPresets([preset("mt", "/w/mt")], {}, deps({ repoOf, now: () => 1000 + 60_001, ttlMs: 60_000 }));
      expect(calls).toEqual(["/w/mt", "/w/mt"]);
    });

    // A directory with no GitHub remote must be remembered as such, or every poll re-runs `git`
    // in it — the most common case in a preset list holding a few non-repo directories.
    it("caches a negative answer too", async () => {
      const { repoOf, calls } = fakeRepos({ "/w/plain": null });
      const shared = deps({ repoOf, now: () => 1000, ttlMs: 60_000 });
      await repoDirsFromPresets([preset("plain", "/w/plain")], {}, shared);
      await repoDirsFromPresets([preset("plain", "/w/plain")], {}, shared);
      expect(calls).toEqual(["/w/plain"]);
    });
  });
});
