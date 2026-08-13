// Choosing a clone has to take effect on the spot. Without adopting it into the loaded answer, the
// snapshot still said "several clones, nothing chosen", so the NEXT issue row in the same repo
// asked again and the choice only worked after a reload (Codex review).
import { describe, it, expect, beforeEach } from "vitest";
import { useIssueStart } from "../../../src/composables/useIssueStart";
import type { RepoDirs } from "../../../common/repoDirs";

const { repoDirs, planFor, rememberClone } = useIssueStart();

const entry = (repo: string, paths: string[]): RepoDirs => ({
  repo,
  dirs: paths.map((path) => ({ path, label: path.split("/").pop() ?? path, orderPriority: null })),
  primary: null,
});

beforeEach(() => {
  repoDirs.value = [entry("acme/web", ["/w/web", "/w/web2"])];
});

describe("rememberClone", () => {
  it("turns a choose into a one-click ready, without a reload", () => {
    expect(planFor("acme/web").kind).toBe("choose");
    rememberClone("acme/web", "/w/web2");
    expect(planFor("acme/web")).toEqual({ kind: "ready", dir: "/w/web2" });
  });

  // The name to record UNDER is the entry's own — derived from the remote — so the config is keyed
  // the way the server reads it rather than however `prRepos` was typed.
  it("returns the resolved repo name to record under, not the caller's spelling", () => {
    expect(rememberClone("Acme/Web", "/w/web2")).toBe("acme/web");
  });

  it("adopts the choice even when the caller's spelling differs in case", () => {
    rememberClone("ACME/WEB", "/w/web");
    expect(planFor("acme/web")).toEqual({ kind: "ready", dir: "/w/web" });
  });

  // A directory that is not one of this repo's candidates must change nothing: the answer decides
  // where a session opens, and adopting an unlisted path would offer one this side never resolved.
  it.each([
    ["a directory that is not a candidate", "acme/web", "/w/elsewhere"],
    ["a repo with no clone here", "acme/api", "/w/web"],
  ])("ignores %s, and records under the caller's spelling", (_case, repo, dir) => {
    expect(rememberClone(repo, dir)).toBe(repo);
    expect(planFor("acme/web").kind).toBe("choose");
  });
});
