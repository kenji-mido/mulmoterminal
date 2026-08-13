// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import os from "node:os";
import { takeScratchHome } from "./scratchHome.js";

// This helper exists because `os.homedir()` reads USERPROFILE on Windows and HOME everywhere else,
// and a spec that stubs only one of them silently tests a directory the code never touched (#1396).
// So the thing worth asserting is the one that platform-specific: that os.homedir() actually moved
// — which on the Windows runner is a real check of the USERPROFILE half.

describe("takeScratchHome", () => {
  it("moves os.homedir() to a fresh directory and puts it back", () => {
    const before = os.homedir();
    const scratch = takeScratchHome("mt-scratch-home-test-");
    try {
      expect(os.homedir()).toBe(scratch.path);
      expect(scratch.path).not.toBe(before);
      expect(existsSync(scratch.path)).toBe(true);
    } finally {
      scratch.release();
    }
    expect(os.homedir()).toBe(before);
  });

  it("removes the directory it made", () => {
    const scratch = takeScratchHome("mt-scratch-home-test-");
    const { path } = scratch;
    scratch.release();
    expect(existsSync(path)).toBe(false);
  });

  it("hands each caller its own directory", () => {
    const first = takeScratchHome("mt-scratch-home-test-");
    const second = takeScratchHome("mt-scratch-home-test-");
    try {
      expect(second.path).not.toBe(first.path);
    } finally {
      second.release();
      first.release();
    }
  });
});
