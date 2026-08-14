// @vitest-environment node
// GET /api/repo-dirs end to end: real temp git repos with real `origin` remotes, so the route,
// the remote resolution and the grouping are exercised together rather than mocked apart. The
// config layer IS mocked — importing it for real reads the developer's own ~/.mulmoterminal.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "../git/wtTestUtil.js";
import type { CwdPreset } from "../../../server/config/config-schema.js";
import type { RepoDirsResponse } from "../../../common/repoDirs.js";

const configState: { presets: CwdPreset[]; recorded: Record<string, string> } = { presets: [], recorded: {} };

vi.mock("../../../server/config/config-routes.js", () => ({
  getCwdPresets: () => configState.presets,
  getRepoDirs: () => configState.recorded,
  getPrRepos: () => [],
  // dir-config reads this when resolving a directory's icon (#1428); the value is irrelevant
  // here, but a partial mock has to carry it or the import throws.
  getAutoDirIcon: () => false,
}));

const { mountRepoRoutes } = await import("../../../server/routes/repo-routes.js");
const { clearRepoDirsCache } = await import("../../../server/git/repo-dirs.js");

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}
const makeRes = (): FakeRes => ({
  statusCode: 200,
  payload: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.payload = body;
    return this;
  },
});

type Handler = (req: unknown, res: FakeRes) => unknown;

function repoDirsHandler(): Handler {
  const map: Record<string, Handler> = {};
  const app = { get: (p: string, h: Handler) => (map[p] = h), post: () => {} } as unknown as Express;
  mountRepoRoutes(app);
  return map["/api/repo-dirs"];
}

const hasGit = (() => {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// A temp directory that is a git repo whose origin is `slug` on GitHub (or no remote at all).
function makeClone(prefix: string, slug: string | null): string {
  const dir = makeTempDir(prefix);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  g("init", "-b", "main");
  writeFileSync(path.join(dir, "README.md"), "hi");
  if (slug) g("remote", "add", "origin", `git@github.com:${slug}.git`);
  return dir;
}

describe("GET /api/repo-dirs", () => {
  const made: string[] = [];
  const clone = (prefix: string, slug: string | null): string => {
    const dir = makeClone(prefix, slug);
    made.push(dir);
    return dir;
  };

  beforeEach(() => {
    clearRepoDirsCache();
    configState.presets = [];
    configState.recorded = {};
  });
  afterEach(() => {
    while (made.length) rmDirRetrying(made.pop() as string);
  });

  it.skipIf(!hasGit)(
    "groups the saved directories by the repo they clone, and honours a recorded choice",
    async () => {
      const a = clone("rd-mt-", "receptron/mulmoterminal");
      const b = clone("rd-mt2-", "receptron/mulmoterminal");
      const other = clone("rd-srv-", "receptron/mulmoserver");
      const plain = clone("rd-plain-", null); // a git repo with no remote — not an error, just absent
      configState.presets = [
        { label: "mt", path: a },
        { label: "mt2", path: b },
        { label: "srv", path: other },
        { label: "plain", path: plain },
      ];
      configState.recorded = { "receptron/mulmoterminal": b };

      const res = makeRes();
      await repoDirsHandler()({}, res);
      const body = res.payload as RepoDirsResponse;

      expect(res.statusCode).toBe(200);
      expect(body.repos.map((r) => r.repo)).toEqual(["receptron/mulmoserver", "receptron/mulmoterminal"]);
      const mt = body.repos.find((r) => r.repo === "receptron/mulmoterminal");
      expect(mt?.dirs.map((d) => d.label).sort()).toEqual(["mt", "mt2"]);
      expect(mt?.primary).toBe(b);
      // The directory with no remote resolves to no repo, so it appears under nothing.
      expect(body.repos.flatMap((r) => r.dirs.map((d) => d.path))).not.toContain(plain);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "answers with an empty list when no saved directory is a GitHub clone",
    async () => {
      configState.presets = [{ label: "plain", path: clone("rd-none-", null) }];
      const res = makeRes();
      await repoDirsHandler()({}, res);
      expect((res.payload as RepoDirsResponse).repos).toEqual([]);
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
