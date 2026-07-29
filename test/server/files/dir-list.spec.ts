import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { resolveListPath, listEntries } from "../../../server/files/dir-list.js";

describe("resolveListPath", () => {
  it("defaults to home for a missing or empty param", () => {
    expect(resolveListPath(undefined)).toBe(homedir());
    expect(resolveListPath("")).toBe(homedir());
    expect(resolveListPath(123)).toBe(homedir());
  });

  it("resolves a relative path to absolute rather than trusting it raw", () => {
    expect(path.isAbsolute(resolveListPath("some/rel"))).toBe(true);
  });

  it("keeps an absolute path", () => {
    expect(resolveListPath("/usr/local")).toBe("/usr/local");
  });
});

describe("listEntries", () => {
  it("returns only sub-directories by default, sorted case-insensitively, files excluded", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-dirlist-"));
    try {
      mkdirSync(path.join(root, "Beta"));
      mkdirSync(path.join(root, "alpha"));
      mkdirSync(path.join(root, "Gamma"));
      writeFileSync(path.join(root, "a-file.txt"), "x");
      const entries = listEntries(root);
      expect(entries.map((e) => e.name)).toEqual(["alpha", "Beta", "Gamma"]);
      expect(entries.every((e) => e.dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes files after directories when includeFiles is set, each tagged with a dir flag", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-dirlist-"));
    try {
      mkdirSync(path.join(root, "sub"));
      writeFileSync(path.join(root, "Zed.txt"), "x");
      writeFileSync(path.join(root, "apple.md"), "x");
      const entries = listEntries(root, true);
      // dirs first, then files — each group case-insensitively sorted
      expect(entries.map((e) => e.name)).toEqual(["sub", "apple.md", "Zed.txt"]);
      expect(entries.map((e) => e.dir)).toEqual([true, false, false]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns absolute paths joined under the parent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-dirlist-"));
    try {
      mkdirSync(path.join(root, "child"));
      const entry = listEntries(root).find((e) => e.name === "child");
      expect(entry?.path).toBe(path.join(root, "child"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws for a directory that does not exist (caller falls back to home)", () => {
    expect(() => listEntries(path.join(tmpdir(), "mt-dirlist-missing-xyz"))).toThrow();
  });
});
