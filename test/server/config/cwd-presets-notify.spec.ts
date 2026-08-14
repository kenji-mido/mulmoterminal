// @vitest-environment node
//
// The saved directories ARE the projects the collection watchers mount for, so a directory added
// mid-session used to wait out a 60s poll before its collections could ring — long enough that a
// new project's first collection reads as broken. The config route now says when the list moved.
//
// Deliberately a callback rather than an import: the config module stays config-shaped, and the
// watchers are the caller's concern (server/routes/app-routes.ts wires them).
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import express from "express";
import request from "supertest";
import { tmpdir } from "node:os";
import path from "node:path";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A config route mounted against a throwaway HOME, with the change callback captured. `HOME` and
 *  `USERPROFILE` both, because `os.homedir()` reads the latter on Windows — stubbing one left a
 *  Windows run pointed at the real config. */
async function mountAgainstTempHome(initial: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-presets-notify-"));
  dirs.push(dir);
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  // WRITTEN BEFORE THE IMPORT, because that is the order production has: the module reads the
  // file once at load and serves that list until something writes. A fixture that writes it
  // afterwards leaves the module's view empty while the disk is full — a state the server is
  // never in, and one that makes the "did the list THIS process serves move?" comparison look
  // wrong when it is right.
  mkdirSync(path.join(dir, ".mulmoterminal"), { recursive: true });
  writeFileSync(path.join(dir, ".mulmoterminal", "config.json"), JSON.stringify(initial, null, 2));
  vi.resetModules();
  const { mountConfigRoutes, APP_CONFIG_FILE } = await import("../../../server/config/config-routes.js");
  // Guard: a stub that did not take would have targeted the real config.
  expect(APP_CONFIG_FILE.startsWith(dir), "config path must be inside the temp HOME").toBe(true);

  const onChanged = vi.fn();
  const app = express();
  app.use(express.json());
  mountConfigRoutes(app, dir, onChanged);
  return { app, onChanged, configFile: APP_CONFIG_FILE };
}

const PRESETS = [{ label: "mag2", path: "/srv/mag2" }];

describe("POST /api/config tells the caller when the saved directories move", () => {
  it("fires when a directory is added", async () => {
    const { app, onChanged } = await mountAgainstTempHome({});
    const res = await request(app).post("/api/config").send({ cwdPresets: PRESETS });
    expect(res.status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("fires when one is removed", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: PRESETS });
    await request(app).post("/api/config").send({ cwdPresets: [] });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // The write that saves a sound, a theme or a keymap is the common one, and waking the watchers
  // for it would be work with no question behind it.
  it("stays quiet for a write that leaves the list alone", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: PRESETS });
    await request(app).post("/api/config").send({ pushEnabled: true });
    await request(app).post("/api/config").send({ cwdPresets: PRESETS });
    expect(onChanged).not.toHaveBeenCalled();
  });

  // A relabelled preset is the SAME directory to everything downstream — the watchers and the
  // project ids are keyed by path.
  it("stays quiet when only a label changed", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: PRESETS });
    await request(app)
      .post("/api/config")
      .send({ cwdPresets: [{ label: "renamed", path: "/srv/mag2" }] });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("fires when the same count points somewhere else", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: PRESETS });
    await request(app)
      .post("/api/config")
      .send({ cwdPresets: [{ label: "mag2", path: "/srv/elsewhere" }] });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // ANOTHER INSTANCE'S CHANGE, absorbed here. Every mulmoterminal on the machine shares the file,
  // and a POST re-reads it as the merge base — so an unrelated write (a sound, a theme) can move
  // THIS process from one project list to another. Comparing the disk to itself sees nothing;
  // comparing what we WERE serving to what we now serve is the question the watchers are asking.
  it("fires when an unrelated write absorbs a list another instance saved", async () => {
    const { app, onChanged, configFile } = await mountAgainstTempHome({ cwdPresets: PRESETS });
    // A second instance adds a directory behind our back.
    writeFileSync(configFile, JSON.stringify({ cwdPresets: [...PRESETS, { label: "site", path: "/srv/site" }] }, null, 2));
    // …and we save something else entirely.
    const res = await request(app).post("/api/config").send({ pushEnabled: true });
    expect(res.status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // The config is ALREADY on disk when the subscriber runs, so a subscriber that fails must not
  // turn a save that succeeded into a 500 the client will retry.
  it("answers 200 even when the subscriber throws", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-presets-notify-"));
    dirs.push(dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.resetModules();
    const { mountConfigRoutes, APP_CONFIG_FILE } = await import("../../../server/config/config-routes.js");
    expect(APP_CONFIG_FILE.startsWith(dir), "config path must be inside the temp HOME").toBe(true);
    mkdirSync(path.dirname(APP_CONFIG_FILE), { recursive: true });
    writeFileSync(APP_CONFIG_FILE, "{}");
    const app = express();
    app.use(express.json());
    mountConfigRoutes(app, dir, () => {
      throw new Error("watchers exploded");
    });

    const res = await request(app).post("/api/config").send({ cwdPresets: PRESETS });
    expect(res.status).toBe(200);
    // …and the save is real, not merely reported.
    expect(JSON.parse(readFileSync(APP_CONFIG_FILE, "utf8")).cwdPresets).toHaveLength(1);
  });

  it("answers 200 when the subscriber's promise rejects", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-presets-notify-"));
    dirs.push(dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.resetModules();
    const { mountConfigRoutes, APP_CONFIG_FILE } = await import("../../../server/config/config-routes.js");
    mkdirSync(path.dirname(APP_CONFIG_FILE), { recursive: true });
    writeFileSync(APP_CONFIG_FILE, "{}");
    const app = express();
    app.use(express.json());
    mountConfigRoutes(app, dir, async () => {
      await Promise.reject(new Error("sync failed"));
    });

    expect((await request(app).post("/api/config").send({ cwdPresets: PRESETS })).status).toBe(200);
  });

  // Mounting without one is what every other caller does; the route must not require it.
  it("does not require a subscriber", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-presets-notify-"));
    dirs.push(dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.resetModules();
    const { mountConfigRoutes } = await import("../../../server/config/config-routes.js");
    const app = express();
    app.use(express.json());
    mountConfigRoutes(app, dir);
    expect((await request(app).post("/api/config").send({ cwdPresets: PRESETS })).status).toBe(200);
  });
});
