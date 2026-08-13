// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { appRequest } from "../../helpers/appRequest";
import { isClientRoute, mountSpaFallback } from "../../../server/infra/spa-fallback";

describe("SPA fallback matcher", () => {
  it("serves the SPA shell for client routes", () => {
    expect(isClientRoute("/")).toBe(true);
    expect(isClientRoute("/terminals")).toBe(true);
    expect(isClientRoute("/collections")).toBe(true);
    expect(isClientRoute("/collections/foo")).toBe(true);
    expect(isClientRoute("/feeds/tech-news")).toBe(true);
    expect(isClientRoute("/accounting")).toBe(true);
  });

  it("never shadows the /api prefix (incl. unknown api paths and the GUI MCP route)", () => {
    expect(isClientRoute("/api/sessions")).toBe(false);
    expect(isClientRoute("/api/mcp/abc-123")).toBe(false);
    expect(isClientRoute("/api/collections/foo/detail")).toBe(false);
    expect(isClientRoute("/api/this-route-does-not-exist")).toBe(false);
    // The bare /api path is reserved too — it must 404, not serve the SPA shell.
    expect(isClientRoute("/api")).toBe(false);
  });

  it("does not over-reserve paths that merely start with the letters 'api'", () => {
    // /apidocs is a client route — only the /api segment itself is reserved.
    expect(isClientRoute("/apidocs")).toBe(true);
  });
});

// #954. The matcher above was the ONLY thing tested, and it was right the whole time — the
// bug was that the handler behind it never returned the file. `npx` expands the package under
// `~/.npm/_npx/…`, and `send` with no `root` runs its dotfile check over the whole absolute
// path, so every npx install answered 404 to a reload while the assets loaded fine.
describe("mounting the SPA fallback", () => {
  let dir: string;

  beforeEach(async () => {
    // A dot segment ABOVE the served root — exactly the shape `~/.npm/_npx/<hash>/…` has.
    dir = await mkdtemp(path.join(tmpdir(), "spa-"));
    await mkdir(path.join(dir, ".npm", "dist"), { recursive: true });
    await writeFile(path.join(dir, ".npm", "dist", "index.html"), "<html>shell</html>");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const serve = async (distDir: string, url: string) => {
    const app = express();
    mountSpaFallback(app, distDir);
    const res = await appRequest(app)(url);
    return { status: res.status, body: await res.text() };
  };

  it("serves the shell from a dist under a dot directory", async () => {
    expect(await serve(path.join(dir, ".npm", "dist"), "/terminals")).toEqual({ status: 200, body: "<html>shell</html>" });
  });

  it("serves it for the root route too", async () => {
    expect((await serve(path.join(dir, ".npm", "dist"), "/")).status).toBe(200);
  });

  // The reserved prefix has to keep 404ing rather than picking up the shell — a mistyped API
  // path must fail loudly. Asserted on the mounted app, not just the regex.
  it("still leaves /api alone", async () => {
    expect((await serve(path.join(dir, ".npm", "dist"), "/api/nope")).status).toBe(404);
  });
});
