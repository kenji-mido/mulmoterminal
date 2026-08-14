import { describe, it, expect } from "vitest";
import { parseUpdateNotice, versionDisplay } from "../../../src/composables/updateNotice";
import type { UpdateStatus } from "../../../common/updateStatus";

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  ready: true,
  install: "npm",
  version: "4.7.0",
  commit: null,
  latest: null,
  notice: null,
  ...over,
});

describe("parseUpdateNotice", () => {
  it("is null when there is no notice", () => {
    expect(parseUpdateNotice(null)).toBeNull();
    expect(parseUpdateNotice(undefined)).toBeNull();
    expect(parseUpdateNotice("")).toBeNull();
  });

  // The command after "run: " is pulled out so the badge can copy just that.
  it("pulls the npm command out of the notice", () => {
    const badge = parseUpdateNotice("Update available: 0.7.1 → 0.8.0  ·  run: npm i -g mulmoterminal");
    expect(badge).toEqual({
      text: "Update available: 0.7.1 → 0.8.0  ·  run: npm i -g mulmoterminal",
      command: "npm i -g mulmoterminal",
    });
  });

  it("pulls the git command out of the notice", () => {
    expect(parseUpdateNotice("Update available: a1b2c3d → origin  ·  run: git pull")?.command).toBe("git pull");
  });

  // A notice without the marker still shows (as the tooltip); there is just nothing to copy.
  it("keeps the text but has no command when there is no run marker", () => {
    expect(parseUpdateNotice("A new version is out")).toEqual({ text: "A new version is out", command: null });
  });
});

describe("versionDisplay", () => {
  // Nothing read yet: the line must render nothing rather than a version nobody is on.
  it("is null without a status", () => {
    expect(versionDisplay(null)).toBeNull();
    expect(versionDisplay(undefined)).toBeNull();
  });

  it("names the package version for an npm install, with no commit", () => {
    expect(versionDisplay(status())).toEqual({ version: "4.7.0", commit: null });
  });

  // A checkout's package.json version is only the last release, so the commit is what identifies
  // the running build.
  it("carries the commit for a git checkout", () => {
    expect(versionDisplay(status({ install: "git", commit: "a1b2c3d" }))).toEqual({ version: "4.7.0", commit: "a1b2c3d" });
  });

  it("keeps the version when the checkout's commit could not be read", () => {
    expect(versionDisplay(status({ install: "git", commit: null }))).toEqual({ version: "4.7.0", commit: null });
  });

  // Before the probe lands, `install` is a placeholder — so a commit must not be claimed on the
  // strength of it.
  it("withholds the commit until the check is ready", () => {
    expect(versionDisplay(status({ ready: false, install: "git", commit: "a1b2c3d" }))).toEqual({ version: "4.7.0", commit: null });
  });
});
