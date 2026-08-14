// @vitest-environment node
// GET /api/dir-icon (#1421). The path never comes from the request — it is read from that
// directory's own `.mulmoterminal.json` — so what this pins is the other half: the headers that
// decide what the served bytes are allowed to be once they reach a browser.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountDirRoutes } from "../../../server/routes/dir-routes";

const app = express();
mountDirRoutes(app);

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function projectWith(icon: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-iconroute-"));
  dirs.push(dir);
  Object.entries(files).forEach(([name, body]) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  });
  writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify({ icon }));
  return dir;
}

describe("GET /api/dir-icon", () => {
  it("serves the directory's own image", async () => {
    const dir = projectWith("docs/logo.gif", { "docs/logo.gif": "GIF89a-pretend" });
    const res = await request(app).get("/api/dir-icon").query({ cwd: dir }).buffer(true);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("GIF89a-pretend");
  });

  // The type is ours, from the extension map — not express's guess — and `nosniff` holds the
  // browser to it. `sandbox` is what makes SVG safe to allow: an <img> never runs its scripts,
  // but this URL can be opened directly, and a unique origin keeps a logo out of the app's.
  it("types the response itself and sandboxes it", async () => {
    const dir = projectWith("logo.svg", { "logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>" });
    const res = await request(app).get("/api/dir-icon").query({ cwd: dir });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  // The claim above — that the type is OURS — is only testable where the two disagree, and .svg
  // isn't such a case. .ico is: our map says image/x-icon, express's mime-db says
  // image/vnd.microsoft.icon. If a future express started overwriting a pre-set Content-Type,
  // every other case would still pass and only this one would catch it.
  it("keeps our type where express's own guess differs", async () => {
    const dir = projectWith("favicon.ico", { "favicon.ico": "icobytes" });
    const res = await request(app).get("/api/dir-icon").query({ cwd: dir });
    expect(res.headers["content-type"]).toContain("image/x-icon");
  });

  it("serves an image from a dot-directory", async () => {
    const dir = projectWith(".mulmoterminal/logo.png", { ".mulmoterminal/logo.png": "png-bytes" });
    const res = await request(app).get("/api/dir-icon").query({ cwd: dir }).buffer(true);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("png-bytes");
  });

  it("404s when the directory sets no icon", async () => {
    const dir = projectWith(undefined);
    expect((await request(app).get("/api/dir-icon").query({ cwd: dir })).status).toBe(404);
  });

  // Nothing to serve: the browser loads a remote icon itself and never asks us for it.
  it("404s for a remote icon", async () => {
    const dir = projectWith("https://example.com/logo.png");
    expect((await request(app).get("/api/dir-icon").query({ cwd: dir })).status).toBe(404);
  });

  // The loader already refused these, so the route has nothing to serve — which is the point:
  // the request cannot name a file, only a directory whose config names one.
  it.each([
    ["an escape via ..", "../outside.png"],
    ["a non-image file", "notes.md"],
    ["a file that isn't there", "missing.png"],
  ])("404s for %s", async (_case, icon) => {
    const dir = projectWith(icon, { "notes.md": "# hi" });
    expect((await request(app).get("/api/dir-icon").query({ cwd: dir })).status).toBe(404);
  });

  it("refuses a request that cannot name a directory", async () => {
    expect((await request(app).get("/api/dir-icon").query({ cwd: "relative/path" })).status).toBe(400);
  });
});
