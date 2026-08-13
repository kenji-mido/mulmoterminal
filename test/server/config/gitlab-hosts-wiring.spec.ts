// @vitest-environment node
// The one link between the config and the forge layer (#1332): `config-routes` tells `forge-host`
// where the declared hosts come from, at import time.
//
// It gets its own spec because nothing else can fail when it goes. `forge-host` defaults to "no
// declared hosts", which is exactly how the app behaved before the setting existed — so deleting
// the wiring leaves every other test green while a user's `gitlabHosts` silently does nothing,
// with the row still saying the host is unsupported. That is the shape of bug this whole feature
// was filed about.
import { describe, it, expect, vi, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

const DECLARED = "gitlab.declared.test";
const home = mkdtempSync(path.join(os.tmpdir(), "mt-gitlab-hosts-"));
mkdirSync(path.join(home, ".mulmoterminal"), { recursive: true });
writeFileSync(path.join(home, ".mulmoterminal", "config.json"), JSON.stringify({ gitlabHosts: [DECLARED] }));

// Before the imports below, and never in a `beforeEach`: `config-routes` resolves
// `~/.mulmoterminal/config.json` and reads it while the module is evaluating, so a spy installed
// later would be reading the developer's own home directory instead.
vi.spyOn(os, "homedir").mockReturnValue(home);

const { getGitlabHosts } = await import("../../../server/config/config-routes.js");
const { forgeFromRepoEntry } = await import("../../../server/git/forge-host.js");

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("the gitlabHosts wiring", () => {
  it("reads the declaration out of the config file", () => {
    expect(getGitlabHosts()).toEqual([DECLARED]);
  });

  // The assertion that matters: `forge-host` is asked nothing here, and no test sets it up — it
  // answers `gitlab` only because importing the config module handed it the getter.
  it("makes the declared host a GitLab everywhere the forge is resolved", () => {
    expect(forgeFromRepoEntry(`${DECLARED}/group/project`)?.kind).toBe("gitlab");
  });

  it("leaves a host nobody declared alone", () => {
    expect(forgeFromRepoEntry("gitea.undeclared.test/owner/repo")?.kind).toBe("unknown");
  });
});
