// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { loadDirConfig } from "../../../server/config/dir-config";
import { inheritedWorktreeConfig, writeInheritedDirConfig } from "../../../server/config/worktree-dir-config";

const CONFIG_FILE = ".mulmoterminal.json";

// Written and read back through loadDirConfig rather than hand-built, so these tests exercise
// the same validation the server does — a field the loader would drop can't pass here.
function projectDir(config: Record<string, unknown> | null): string {
  const dir = makeTempDir("mt-wtcfg-");
  if (config) writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify(config), "utf8");
  return dir;
}

const inheritedFrom = (config: Record<string, unknown> | null, index: number) => inheritedWorktreeConfig(loadDirConfig(projectDir(config)), index);

const PROJECT = {
  name: "mulmoterminal",
  theme: "midnight",
  colors: { background: "#101020" },
  fontSize: 13,
  fontFamily: "Menlo, monospace",
  provider: "ollama",
  model: "qwen3:8b",
  badgeColor: "#1b3479",
  headerColor: "#2d4ea9",
  headerTextColor: "#ffffff",
  cellColor: "#f2f4fb",
  cellBorderColor: "#5175d6",
  dotColor: "#5175d6",
  buttonColor: "#cfdaf7",
  orderPriority: 30,
};

describe("inheritedWorktreeConfig", () => {
  it("carries the project's identity over unchanged", () => {
    expect(inheritedFrom(PROJECT, 1)).toMatchObject({
      name: "mulmoterminal",
      theme: "midnight",
      colors: { background: "#101020" },
      fontSize: 13,
      fontFamily: "Menlo, monospace",
      provider: "ollama",
      model: "qwen3:8b",
    });
  });

  it("tints the chrome colours, a step further for each worktree", () => {
    const first = inheritedFrom(PROJECT, 1);
    const second = inheritedFrom(PROJECT, 2);
    expect(first.headerColor).toBe("#2d35a9");
    expect(second.headerColor).toBe("#3e2da9");
    expect(first.badgeColor).not.toBe(PROJECT.badgeColor);
    expect(second.badgeColor).not.toBe(first.badgeColor);
    // The terminal's own palette is identity, not chrome: rotating it would move the ANSI
    // colours a program's output names.
    expect(second.colors).toEqual(PROJECT.colors);
  });

  it("leaves a grey chrome colour exactly as the project wrote it", () => {
    expect(inheritedFrom(PROJECT, 3).headerTextColor).toBe("#ffffff");
  });

  // The worktree sorts directly after the project it was cut from, instead of falling to the
  // end of the grid as an unranked directory does.
  it("ranks the worktree one past its parent", () => {
    expect(inheritedFrom(PROJECT, 1).orderPriority).toBe(31);
    expect(inheritedFrom(PROJECT, 2).orderPriority).toBe(31);
  });

  it("invents no rank for a project that declares none", () => {
    expect(inheritedFrom({ headerColor: "#2d4ea9" }, 1)).not.toHaveProperty("orderPriority");
  });

  // Copied verbatim these would misfire: the sound file lives in the parent directory, and
  // addDirs entries resolve against whichever directory the config sits in.
  it("carries neither the sounds nor the extra directories", () => {
    const dir = projectDir({ sound: "ding.mp3", sounds: { done: "preset:chime" }, addDirs: ["."], headerColor: "#2d4ea9" });
    writeFileSync(path.join(dir, "ding.mp3"), "x", "utf8");
    const inherited = inheritedWorktreeConfig(loadDirConfig(dir), 1);
    expect(inherited).not.toHaveProperty("sound");
    expect(inherited).not.toHaveProperty("sounds");
    expect(inherited).not.toHaveProperty("addDirs");
    expect(inherited.headerColor).toBe("#2d35a9");
  });

  it("has nothing to say about a project that configures nothing", () => {
    expect(inheritedFrom(null, 1)).toEqual({});
    expect(inheritedFrom({ sound: "gone.mp3" }, 1)).toEqual({});
  });

  // Number.MAX_SAFE_INTEGER + 1 is not distinct from its neighbour, so it cannot express a rank
  // — and the loader on the other side would read it back as unset.
  it("drops a rank that cannot be stepped past", () => {
    expect(inheritedFrom({ orderPriority: Number.MAX_SAFE_INTEGER }, 1)).not.toHaveProperty("orderPriority");
  });
});

describe("writeInheritedDirConfig", () => {
  it("writes a config the loader reads back", () => {
    const worktree = makeTempDir("mt-wt-");
    expect(writeInheritedDirConfig(projectDir(PROJECT), worktree, 1)).toBe(true);
    const loaded = loadDirConfig(worktree);
    expect(loaded.name).toBe("mulmoterminal");
    expect(loaded.headerColor).toBe("#2d35a9");
    expect(loaded.orderPriority).toBe(31);
    expect(loaded.model).toBe("qwen3:8b");
  });

  it("leaves no file behind when there is nothing to inherit", () => {
    const worktree = makeTempDir("mt-wt-");
    expect(writeInheritedDirConfig(projectDir(null), worktree, 1)).toBe(false);
    expect(existsSync(path.join(worktree, CONFIG_FILE))).toBe(false);
  });

  // A worktree that already has one either committed it or was set up by hand; either way that
  // file is the answer and ours would silently replace it.
  it("never overwrites a config the worktree already has", () => {
    const worktree = makeTempDir("mt-wt-");
    writeFileSync(path.join(worktree, CONFIG_FILE), '{"name":"mine"}', "utf8");
    expect(writeInheritedDirConfig(projectDir(PROJECT), worktree, 1)).toBe(false);
    expect(readFileSync(path.join(worktree, CONFIG_FILE), "utf8")).toBe('{"name":"mine"}');
  });
});
