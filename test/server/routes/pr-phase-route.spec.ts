// @vitest-environment node
// The /api/pr-phase contract, pinned at the route. The handler answers from two places — a
// resolved GitHub branch, and the "this dir has no repo/remote" shortcut — and those used to
// return different shapes, the shortcut still sending the pre-#979 `{ phase, url }` (Codex
// review). A client written against the typed shape would read `undefined` from it, and nothing
// in the type system says so, because the route hands express a plain object.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountDirRoutes } from "../../../server/routes/dir-routes";
import { EMPTY_WORK_ITEM } from "../../../common/prPhase";

const app = express();
app.use(express.json());
mountDirRoutes(app);

describe("GET /api/pr-phase", () => {
  it("answers the full WorkItem shape for a directory that is not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-prphase-"));
    try {
      const res = await request(app).get("/api/pr-phase").query({ cwd: dir });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(EMPTY_WORK_ITEM);
      // Named individually so a future shape change has to face each field, not just a deep-equal.
      expect(Object.keys(res.body).sort()).toEqual(["blockedReason", "issue", "issueTitle", "issueUrl", "phase", "pr", "prTitle", "prUrl"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The write half (#979 Phase 2). Both collaborators are stubbed, and that is the point rather
// than convenience: the route reads the REAL ~/.mulmoterminal/config.json at import, and the real
// ensureWorkComment shells out to `gh`. An earlier version of this file did neither — so the day
// the maintainer turned the setting on, running the suite posted a live comment on a public issue.
vi.mock("../../../server/config/config-routes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/config/config-routes.js")>()),
  getIssueWorkComments: () => enabled,
}));
vi.mock("../../../server/git/work-comment.js", () => ({
  ensureWorkComment: (...args: unknown[]) => {
    ensureCalls.push(args);
    return Promise.resolve({ posted: true });
  },
}));

let enabled = false;
const ensureCalls: unknown[][] = [];

describe("POST /api/work-comment", () => {
  beforeEach(() => {
    enabled = false;
    ensureCalls.length = 0;
  });

  it("writes nothing while the setting is off, and says why", async () => {
    const res = await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, kind: "start" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posted: false, reason: "disabled" });
    expect(ensureCalls).toHaveLength(0); // nothing even reached the gh layer
  });

  it.each([
    ["an unknown kind", { issue: 979, kind: "shipped" }],
    ["no kind", { issue: 979 }],
    ["no issue", { kind: "start" }],
    ["issue zero", { issue: 0, kind: "start" }],
    ["a fractional issue", { issue: 1.5, kind: "start" }],
    ["an issue that is not a number", { issue: "979", kind: "start" }],
    // The whole content of the PR milestone is the number, so a request without one says nothing.
    ["the pr kind with no PR number", { issue: 979, kind: "pr" }],
    ["the pr kind with PR zero", { issue: 979, pr: 0, kind: "pr" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app).post("/api/work-comment").send(body);
    expect(res.status).toBe(400);
    expect(ensureCalls).toHaveLength(0);
  });

  it("passes the PR milestone through with its number, and does not close the issue", async () => {
    enabled = true;
    await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, pr: 987, kind: "pr" });
    expect(ensureCalls[0][2]).toBe("pr");
    expect(ensureCalls[0][4]).toBe(987);
    expect(ensureCalls[0][5]).toEqual({ closeIssue: false });
  });

  it("asks for the merged comment to close the issue, and the start comment not to", async () => {
    enabled = true;
    await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, pr: 987, kind: "merged" });
    await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, kind: "start" });
    expect(ensureCalls).toHaveLength(2);
    expect(ensureCalls[0][2]).toBe("merged");
    expect(ensureCalls[0][5]).toEqual({ closeIssue: true });
    expect(ensureCalls[1][2]).toBe("start");
    expect(ensureCalls[1][5]).toEqual({ closeIssue: false });
  });

  // A write route must not fall back to the default workspace: a stale preset or a malformed
  // request would otherwise comment on the workspace's repo — a different issue thread entirely
  // (Codex review).
  it.each([
    ["no cwd at all", undefined],
    ["a relative path", "some/where"],
    ["a directory that does not exist", "/no/such/directory-for-mulmoterminal"],
    ["a file rather than a directory", process.argv[1]],
    ["a cwd that is not a string", 42],
  ])("writes nothing for %s", async (_label, cwd) => {
    enabled = true;
    const res = await request(app).post("/api/work-comment").send({ cwd, issue: 979, kind: "start" });
    expect(res.body).toEqual({ posted: false, reason: "no-cwd" });
    expect(ensureCalls).toHaveLength(0);
  });

  // The directory reaches the comment as a bare folder name, never the path (#979).
  it("passes the directory as its basename", async () => {
    enabled = true;
    await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, kind: "start" });
    expect(ensureCalls[0][3]).toBe(path.basename(process.cwd()));
  });
});
