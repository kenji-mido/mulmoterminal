// @vitest-environment node
// #1151, the read half: a route asked ABOUT a directory must not answer about a different one
// under the requested one's name. `/api/scripts` is the sharpest case — the `cwd` it returns is
// where the cell then RUNS the script — but the same swap reached sessions, colours, git status
// and the cost roll-up.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountDirRoutes } from "../../../server/routes/dir-routes";
import { CLAUDE_CWD } from "../../../server/config/env";

const app = express();
app.use(express.json());
mountDirRoutes(app);

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-cwdroute-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("a route asked about a directory it cannot use", () => {
  it("answers 404 with the reason instead of the default workspace's scripts", async () => {
    await withTempDir(async (dir) => {
      const gone = path.join(dir, "deleted-project");
      const res = await request(app).get("/api/scripts").query({ cwd: gone });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain(gone);
      expect(res.body.error).toContain("no longer exists");
      // The point of the 404: no `cwd` the cell could go on to run something in.
      expect(res.body.scripts).toBeUndefined();
    });
  });

  it("answers 400 for a request that cannot name a directory at all", async () => {
    const relative = await request(app).get("/api/scripts").query({ cwd: "relative/path" });
    expect(relative.status).toBe(400);
    expect(relative.body.error).toContain("not an absolute path");
    // Express hands a repeated param over as an array; it was asked for, so it is refused.
    const repeated = await request(app).get("/api/scripts?cwd=/tmp&cwd=/etc");
    expect(repeated.status).toBe(400);
  });

  it("answers a file the same way — a working directory has to be a directory", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "not-a-dir");
      writeFileSync(file, "");
      const res = await request(app).get("/api/scripts").query({ cwd: file });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("is a file, not a directory");
    });
  });

  // The half that must NOT change: no directory was named, so the default workspace is the answer
  // the caller wanted. That is the case the fallback was always right for.
  it("still answers the default workspace when no directory is named", async () => {
    const res = await request(app).get("/api/scripts");
    expect(res.status).toBe(200);
    expect(res.body.cwd).toBe(CLAUDE_CWD);
  });

  it("still answers about a directory that is there", async () => {
    await withTempDir(async (dir) => {
      const res = await request(app).get("/api/scripts").query({ cwd: dir });
      expect(res.status).toBe(200);
      expect(res.body.cwd).toBe(dir);
    });
  });

  // Every `?cwd=` read route shares the guard, so the colours a stale preset chip wears and the
  // branch its header shows come from the directory asked about or from nowhere.
  it("applies to the other directory-scoped reads, not just scripts", async () => {
    await withTempDir(async (dir) => {
      const gone = path.join(dir, "deleted-project");
      for (const route of ["/api/dir-config", "/api/git-status", "/api/skills", "/api/header"]) {
        const res = await request(app).get(route).query({ cwd: gone });
        expect(res.status, route).toBe(404);
        expect(res.body.error, route).toContain("no longer exists");
      }
    });
  });
});
