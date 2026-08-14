// @vitest-environment node
// The wiring of auto-detection (#1428): WHEN it runs, and the promise that "what the file said"
// stays separate from "what ends up on screen". detectDirIcon's own search order is pinned in
// dir-icon-detect.spec.ts; this is about the decision to search at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { loadDirConfig, publicDirConfig, dirIconFor, dirConfigDetail } from "../../../server/config/dir-config";
import * as configRoutes from "../../../server/config/config-routes";
import { inheritedWorktreeConfig } from "../../../server/config/worktree-dir-config";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A project that ships a favicon, plus whatever its `.mulmoterminal.json` says.
function project(
  config: Record<string, unknown> | null,
  files: Record<string, string> = { "public/favicon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>" },
): string {
  const dir = makeTempDir("mt-autowire-");
  dirs.push(dir);
  Object.entries(files).forEach(([name, body]) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  });
  if (config) writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify(config));
  return dir;
}

let autoOn: ReturnType<typeof vi.spyOn>;
beforeEach(() => (autoOn = vi.spyOn(configRoutes, "getAutoDirIcon").mockReturnValue(true)));
afterEach(() => autoOn.mockRestore());

describe("when auto-detection runs", () => {
  it("picks up the repository's favicon when no config file exists at all", () => {
    const dir = project(null);
    expect(dirIconFor(dir)).toMatchObject({ source: "file", ref: "public/favicon.svg" });
    expect(publicDirConfig(dir).iconUrl).toContain("/api/dir-icon?cwd=");
  });

  it("picks it up when the file exists but names no icon", () => {
    expect(dirIconFor(project({ name: "proj", badgeColor: "#112233" }))).toMatchObject({ ref: "public/favicon.svg" });
  });

  it("does not search when the file names an icon", () => {
    const dir = project({ icon: "logo.png" }, { "public/favicon.svg": "<svg/>", "logo.png": "x" });
    expect(dirIconFor(dir)).toMatchObject({ ref: "logo.png" });
  });

  // A written value that failed to resolve is a BROKEN setting. Falling back to a found icon
  // would put a picture on the cell and hide the mistake — the opposite of what the settings
  // preview exists to surface.
  it("does not paper over an icon the file named and got wrong", () => {
    const dir = project({ icon: "typo.png" });
    expect(dirIconFor(dir)).toBeNull();
    expect(publicDirConfig(dir).iconUrl).toBeNull();
  });

  it("stops for an explicit `icon: false`", () => {
    const dir = project({ icon: false });
    expect(loadDirConfig(dir).icon).toBe("off");
    expect(dirIconFor(dir)).toBeNull();
    expect(publicDirConfig(dir).iconUrl).toBeNull();
  });

  it("stops for a global autoDirIcon: false", () => {
    autoOn.mockReturnValue(false);
    expect(dirIconFor(project(null))).toBeNull();
  });
});

// The point of keeping loadDirConfig honest: two other features read it and would both be wrong
// if a found icon were folded into "what the file said".
describe("what the file said stays separate from what is shown", () => {
  it("leaves loadDirConfig().icon null for a directory whose icon was only found", () => {
    const dir = project(null);
    expect(loadDirConfig(dir).icon).toBeNull();
    expect(dirIconFor(dir)).not.toBeNull();
  });

  // Otherwise a worktree's derived config would hardcode a path the user never wrote — and the
  // worktree finds the same file by itself anyway.
  it("does not write a found icon into a worktree's derived config", () => {
    const dir = project({ name: "proj", headerColor: "#2d4ea9" });
    expect(inheritedWorktreeConfig(loadDirConfig(dir), 1)).not.toHaveProperty("icon");
  });

  // `false` DOES travel: a project that turned its icon off would otherwise have worktrees that
  // go looking and find one.
  it("carries an explicit `false` to a worktree", () => {
    expect(inheritedWorktreeConfig(loadDirConfig(project({ icon: false, name: "p" })), 1).icon).toBe(false);
  });

  // The preview has to distinguish a setting from a discovery, which `iconUrl` alone cannot: a
  // picture on a project that configured nothing is exactly what someone opens this panel about.
  it("tells the settings preview which file it found", () => {
    expect(dirConfigDetail(project({ name: "proj" })).extras.autoIcon).toBe("public/favicon.svg");
    expect(dirConfigDetail(project({ icon: "logo.png" }, { "logo.png": "x" })).extras.autoIcon).toBeNull();
    expect(dirConfigDetail(project({ icon: false })).extras.autoIcon).toBeNull();
  });
});
