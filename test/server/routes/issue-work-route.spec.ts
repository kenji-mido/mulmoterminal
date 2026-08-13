// @vitest-environment node
// POST /api/issues/start. The case that matters most is the guard: `dir` arrives from the browser
// and becomes a spawn's working directory, so it has to be one of the clones the server itself
// resolved for that repo — not any path a request cares to name.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "../git/wtTestUtil.js";
import type { CwdPreset } from "../../../server/config/config-schema.js";
import type { SpawnClaudeOptions } from "../../../server/session/spawn-claude.js";

const configState: { presets: CwdPreset[]; recorded: Record<string, string> } = { presets: [], recorded: {} };

vi.mock("../../../server/config/config-routes.js", () => ({
  getCwdPresets: () => configState.presets,
  getRepoDirs: () => configState.recorded,
}));

const issueWork = { start: vi.fn() };
vi.mock("../../../server/git/issue-work.js", () => ({
  startIssueWork: (...args: unknown[]) => issueWork.start(...args),
}));

const { mountIssueWorkRoutes } = await import("../../../server/routes/issue-work-routes.js");
const { clearRepoDirsCache } = await import("../../../server/git/repo-dirs.js");

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  end(): FakeRes;
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
  end() {
    return this;
  },
});

type Handler = (req: { headers: { origin?: string }; body?: unknown; method: string; path: string }, res: FakeRes) => unknown;

const spawnClaudePty = vi.fn<(sessionId: string, resume: null, ws: null, options: SpawnClaudeOptions) => unknown>();

function startHandler(allowOrigin = true): Handler {
  const map: Record<string, Handler> = {};
  const app = {
    post: (p: string, h: (req: unknown, res: FakeRes) => unknown) => {
      map[p] = (req, res) => h({ ...req, method: "POST", path: p }, res);
    },
    get: () => {},
  } as unknown as Express;
  mountIssueWorkRoutes(app, { spawnClaudePty, isAllowedOrigin: () => allowOrigin });
  return map["/api/issues/start"];
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

function makeClone(slug: string): string {
  const dir = makeTempDir("iw-clone-");
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  g("init", "-b", "main");
  writeFileSync(path.join(dir, "README.md"), "hi");
  g("remote", "add", "origin", `git@github.com:${slug}.git`);
  return dir;
}

describe("POST /api/issues/start", () => {
  const made: string[] = [];
  let clone = "";

  beforeEach(() => {
    clearRepoDirsCache();
    spawnClaudePty.mockClear();
    issueWork.start.mockReset();
    issueWork.start.mockResolvedValue({ ok: true, sessionId: "s-1", worktree: "/wt/x", branch: "issue/7-x" });
    if (!hasGit) return;
    clone = makeClone("acme/web");
    made.push(clone);
    configState.presets = [{ label: "web", path: clone }];
    configState.recorded = {};
  });
  afterEach(() => {
    while (made.length) rmDirRetrying(made.pop() as string);
  });

  // Awaited once. An earlier version called the handler a second time to decide whether it had
  // returned a promise, which ran every request twice — and "started nothing" would still have
  // passed while the route started something twice.
  const post = async (body: unknown, allowOrigin = true): Promise<FakeRes> => {
    const res = makeRes();
    await startHandler(allowOrigin)({ headers: {}, body, method: "POST", path: "/api/issues/start" }, res);
    return res;
  };

  it("403s a disallowed origin", async () => {
    const res = await post({ repo: "acme/web", issue: 7, dir: "/w/x" }, false);
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ["a repo that is not owner/repo", { repo: "no-slash", issue: 7, dir: "/w/x" }],
    ["a missing issue number", { repo: "acme/web", dir: "/w/x" }],
    ["issue zero", { repo: "acme/web", issue: 0, dir: "/w/x" }],
    ["a non-integer issue", { repo: "acme/web", issue: 1.5, dir: "/w/x" }],
    ["a missing dir", { repo: "acme/web", issue: 7 }],
  ])("400s %s", async (_case, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
  });

  // The guard. Without it a request could start an agent in any directory on the machine.
  it.skipIf(!hasGit)(
    "403s a dir that is not a known clone of the repo, and starts nothing",
    async () => {
      const elsewhere = makeTempDir("iw-elsewhere-");
      made.push(elsewhere);
      const res = await post({ repo: "acme/web", issue: 7, dir: elsewhere });
      expect(res.statusCode).toBe(403);
      expect(issueWork.start).not.toHaveBeenCalled();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Naming a repo you do have a clone of, with a directory belonging to a DIFFERENT repo, is the
  // same hole wearing a disguise.
  it.skipIf(!hasGit)(
    "403s a dir that clones another repo",
    async () => {
      const other = makeClone("acme/api");
      made.push(other);
      configState.presets = [...configState.presets, { label: "api", path: other }];
      const res = await post({ repo: "acme/web", issue: 7, dir: other });
      expect(res.statusCode).toBe(403);
      expect(issueWork.start).not.toHaveBeenCalled();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "starts the work in a known clone and answers with the session",
    async () => {
      const res = await post({ repo: "acme/web", issue: 7, dir: clone });
      expect(res.statusCode).toBe(200);
      expect(res.payload).toMatchObject({ ok: true, sessionId: "s-1", branch: "issue/7-x" });
      expect(issueWork.start).toHaveBeenCalledWith("acme/web", 7, clone, expect.anything());
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The desktop leaves the seed for review — the issue text was written by whoever opened it, and
  // the Enter is the reader's (#1253 gave the PHONE a `run`, and deliberately not this route).
  //
  // Asserted on the spawn options rather than on the reply, because that is where it would go
  // wrong silently: planDraftInjection resolves `draft ?? initialPrompt`, so a route that grew an
  // initialPrompt would still type the draft and still answer 200 — the auto-run simply would not
  // happen, with nothing raised anywhere.
  it.skipIf(!hasGit)(
    "spawns with the seed as a draft, never as an initialPrompt",
    async () => {
      issueWork.start.mockImplementation(async (_repo: string, _issue: number, _dir: string, deps: { spawnDraft: (cwd: string, seed: string) => string }) => ({
        ok: true,
        sessionId: deps.spawnDraft("/wt/7-x", "GitHub issue #7"),
      }));
      await post({ repo: "acme/web", issue: 7, dir: clone });
      expect(spawnClaudePty).toHaveBeenCalledTimes(1);
      // The seed goes into the WORKTREE, not the clone it was cut from.
      const options = spawnClaudePty.mock.calls[0][3];
      expect(options).toEqual({ cwd: "/wt/7-x", draft: "GitHub issue #7", attachGuiMcp: false });
      expect(options.initialPrompt).toBeUndefined();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // #1219: the issue's worktree is open in somebody's terminal. Something the user can act on
  // (close it there), so it shares the 409 with the other preconditions rather than reading as a
  // server fault.
  it.skipIf(!hasGit)(
    "reports a worktree somebody is holding as a 409, with the sentence saying what to do",
    async () => {
      issueWork.start.mockResolvedValue({ ok: false, reason: "worktree-busy", detail: "this worktree's session is open in another terminal" });
      const res = await post({ repo: "acme/web", issue: 7, dir: clone });
      expect(res.statusCode).toBe(409);
      expect(res.payload).toMatchObject({ detail: expect.stringContaining("another terminal") });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "reports an unreadable issue as a 409 the user can act on",
    async () => {
      issueWork.start.mockResolvedValue({ ok: false, reason: "issue-not-found", detail: "no such issue" });
      const res = await post({ repo: "acme/web", issue: 7, dir: clone });
      expect(res.statusCode).toBe(409);
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
