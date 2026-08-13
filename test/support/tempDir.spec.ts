// @vitest-environment node
//
// The registry behind `test/setup-temp-dirs.ts`. What is being pinned is not that a helper can
// delete a directory — it is that the directory a SPEC created is the one the SETUP FILE later
// sees, which is the assumption the whole fix rests on (#1345).
//
// If those two ever resolve to separate module instances, the registry `afterAll` walks is empty:
// nothing is removed, nothing throws, and every test still passes. The leak would come back
// invisibly, which is exactly how it went unnoticed to 42,000 directories the first time.
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { makeTempDir, makeTempDirAsync, removeTrackedTempDirs, trackedTempDirCount } from "./tempDir";

describe("temp dir registry", () => {
  it("tracks what makeTempDir handed out, and removes it", () => {
    const before = trackedTempDirCount();
    const dir = makeTempDir("mt-registry-");
    expect(trackedTempDirCount()).toBe(before + 1);
    expect(existsSync(dir)).toBe(true);

    removeTrackedTempDirs();
    expect(existsSync(dir)).toBe(false);
    expect(trackedTempDirCount()).toBe(0);
  });

  it("tracks the async form too", async () => {
    const dir = await makeTempDirAsync("mt-registry-async-");
    expect(existsSync(dir)).toBe(true);

    removeTrackedTempDirs();
    expect(existsSync(dir)).toBe(false);
  });

  // The directories specs make are not empty, and a non-recursive remove would leave every one of
  // them behind while looking like it worked.
  it("removes a directory that has contents", () => {
    const dir = makeTempDir("mt-registry-full-");
    mkdirSync(path.join(dir, "nested", "deeper"), { recursive: true });
    writeFileSync(path.join(dir, "nested", "deeper", "file.txt"), "x");

    removeTrackedTempDirs();
    expect(existsSync(dir)).toBe(false);
  });

  // Cleanup runs after the tests have had their say. A spec that removed its own directory, or a
  // Windows handle still open on one, must not turn a passing run red at the very end.
  it("does not throw when a tracked directory is already gone", () => {
    makeTempDir("mt-registry-vanishing-");
    removeTrackedTempDirs();
    expect(() => removeTrackedTempDirs()).not.toThrow();
  });

  // The point of swallowing the error is that cleanup cannot fail a run — but swallowing it and
  // ALSO dropping the path is how a leak survives a sweep that looks like it worked. EBUSY/EPERM on
  // a directory another process still holds is transient on Windows, so the path has to stay.
  //
  // The import is inside the test on purpose: `vi.doMock` is not hoisted, so it only takes effect
  // on a later import (see CLAUDE.md).
  it("keeps a directory it could not remove, so a later sweep tries again", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        rmSync: () => {
          throw new Error("EBUSY: resource busy or locked");
        },
      };
    });

    const stuck = await import("./tempDir");
    const dir = stuck.makeTempDir("mt-registry-stuck-");
    expect(stuck.trackedTempDirCount()).toBe(1);

    expect(() => stuck.removeTrackedTempDirs()).not.toThrow();
    expect(stuck.trackedTempDirCount()).toBe(1);

    vi.doUnmock("node:fs");
    vi.resetModules();
    // That module instance's registry is not the one the setup file sweeps, so this spec owns it.
    rmSync(dir, { recursive: true, force: true });
  });

  it("forgets what it removed, so a second pass is a no-op rather than a re-delete", () => {
    makeTempDir("mt-registry-once-");
    removeTrackedTempDirs();
    expect(trackedTempDirCount()).toBe(0);

    const kept = makeTempDir("mt-registry-kept-");
    expect(trackedTempDirCount()).toBe(1);
    expect(existsSync(kept)).toBe(true);
  });
});
