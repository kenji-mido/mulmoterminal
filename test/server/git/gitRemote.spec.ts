// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Express } from "express";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveGithubUrl, mountGitRemoteRoute } from "../../../server/git/gitRemote.js";

describe("resolveGithubUrl", () => {
  it("maps this repo's origin to its github.com URL", async () => {
    expect(await resolveGithubUrl(process.cwd())).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  });

  it("returns null for a non-git directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gitremote-"));
    try {
      expect(await resolveGithubUrl(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}
function makeRes(): FakeRes {
  return {
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
  };
}

type RouteHandler = (req: { headers: { origin?: string }; body: unknown }, res: FakeRes) => unknown;
type MountedHandler = (req: { headers: { origin?: string }; body: unknown; method: string; path: string }, res: FakeRes) => unknown;

// Capture the route's handler so it can be invoked with mock req/res — no HTTP
// server needed (mirrors how the other server specs exercise units directly).
// The captured handler is wrapped to carry the method and path Express would have set: the
// origin guard reads both, since it is the same rule the central gate applies (a safe method
// is never judged by origin).
function captureHandler(isAllowedOrigin: (o?: string) => boolean): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    post(routePath: string, h: MountedHandler) {
      handler = (req, res) => h({ ...req, method: "POST", path: routePath }, res);
    },
  } as unknown as Express;
  mountGitRemoteRoute(app, { isAllowedOrigin });
  if (!handler) throw new Error("route was not mounted");
  return handler;
}

function githubUrlOf(payload: unknown): string | null {
  return payload && typeof payload === "object" && "githubUrl" in payload ? (payload as { githubUrl: string | null }).githubUrl : null;
}

const allow = () => true;
const deny = () => false;

describe("mountGitRemoteRoute (POST /api/git-remote)", () => {
  it("rejects a disallowed origin with 403", async () => {
    const res = makeRes();
    await captureHandler(deny)({ headers: { origin: "https://evil.example" }, body: { path: process.cwd() } }, res);
    expect(res.statusCode).toBe(403);
  });

  it("requires an absolute path (400)", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: "relative/dir" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("404s a non-existent directory", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: path.join(os.tmpdir(), "no-such-dir-xyz-123456") } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("400s a path that exists but isn't a directory", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: path.join(process.cwd(), "package.json") } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns the GitHub URL for a git repo", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: process.cwd() } }, res);
    expect(res.statusCode).toBe(200);
    expect(githubUrlOf(res.payload)).toMatch(/^https:\/\/github\.com\//);
  });

  it("returns githubUrl: null for a non-git directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gitremote-"));
    try {
      const res = makeRes();
      await captureHandler(allow)({ headers: {}, body: { path: dir } }, res);
      expect(res.statusCode).toBe(200);
      expect(githubUrlOf(res.payload)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The pair `githubUrl` cannot express (#981 step 1): a repo on a forge we do not support and a
  // directory with no remote both answer null there, and only `forge` tells them apart.
  it("reports the forge alongside the GitHub URL", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: process.cwd() } }, res);
    expect(res.payload).toMatchObject({ forge: { host: "github.com", kind: "github" } });
  });

  it("reports forge: null for a directory with no remote", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gitremote-"));
    try {
      const res = makeRes();
      await captureHandler(allow)({ headers: {}, body: { path: dir } }, res);
      expect(res.payload).toMatchObject({ githubUrl: null, forge: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
