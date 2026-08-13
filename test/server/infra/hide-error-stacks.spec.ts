// @vitest-environment node
// Express decides whether a thrown error's stack goes into the response body, and it decides it
// from NODE_ENV at app creation. #955 removed the launcher's NODE_ENV=production — which was
// leaking into every user terminal — so the guarantee has to come from the app itself now.
// These check the guarantee against the real express, not against the docs: an express upgrade
// that changed the rule would change what an error response tells a page about this machine.
import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { hideErrorStacks } from "../../../server/infra/hide-error-stacks.js";

// A path unique enough that finding it in a response body can only mean the stack leaked.
const SECRET = "boom-from-a-real-file-path";

function throwingApp(configure: (app: Express) => void): Express {
  const app = express();
  configure(app);
  app.get("/boom", () => {
    throw new Error(SECRET);
  });
  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hideErrorStacks", () => {
  it("keeps the stack out of the response when a route throws", async () => {
    const res = await request(throwingApp(hideErrorStacks)).get("/boom");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain("at ");
  });

  it("wins over a NODE_ENV that says otherwise", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const app = throwingApp(hideErrorStacks);
    expect(app.get("env")).toBe("production");
    expect((await request(app).get("/boom")).text).not.toContain(SECRET);
  });

  // The control, and the reason the module exists: express really does put the stack in the
  // body otherwise. If this ever stops being true, the helper is no longer load-bearing.
  it("pins what express does without it", async () => {
    const res = await request(throwingApp((app) => app.set("env", "development"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.text).toContain(SECRET);
  });
});
