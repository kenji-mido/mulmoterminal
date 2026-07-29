// Server-side grid state (remote/mobile work): the layout lives at ~/.mulmoterminal/
// grid-state.json so a SECOND browser — the phone — hydrates the same cells instead of an empty
// grid.
//
// The properties worth defending through a port are the ones that are invisible when they break:
// a GET that hands back garbage the client silently drops (an empty grid on the phone), a POST
// that persists but never publishes (two browsers drifting apart), and a write route that any
// site the user visits could call.
//
// `node:os` is mocked to a temp home — otherwise these tests would overwrite the running
// server's real grid.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Express, Request } from "express";

const { HOME } = vi.hoisted(() => ({ HOME: `/tmp/mt-grid-state-${crypto.randomUUID()}` }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual.default, homedir: () => HOME }, homedir: () => HOME };
});

const STATE_FILE = path.join(HOME, ".mulmoterminal", "grid-state.json");
const GRID = { cells: [{ uid: 0, session: "01234567-89ab-cdef-0123-456789abcdef", cwd: "/w/app", launcher: null }], page: 0, sortMode: "manual" };

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

type Handler = (req: Partial<Request>, res: FakeRes) => unknown;

// Mount and hand back the two handlers by path — no HTTP server needed (the tmux-routes pattern).
async function mount(over: { isAllowedOrigin?: () => boolean } = {}) {
  vi.resetModules();
  const { mountGridStateRoutes, GRID_STATE_CHANNEL } = await import("../../../server/config/grid-state-routes.js");
  const handlers = new Map<string, Handler>();
  const app = {
    get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h),
    post: (p: string, h: Handler) => handlers.set(`POST ${p}`, h),
  } as unknown as Express;
  const publish = vi.fn();
  mountGridStateRoutes(app, { isAllowedOrigin: over.isAllowedOrigin ?? (() => true), publish });
  const get = handlers.get("GET /api/grid-state");
  const post = handlers.get("POST /api/grid-state");
  if (!get || !post) throw new Error("grid-state routes were not mounted");
  return { get, post, publish, channel: GRID_STATE_CHANNEL };
}

const saved = async (post: Handler, body: unknown, origin = "http://localhost") => {
  const res = makeRes();
  await post({ headers: { origin }, body } as Partial<Request>, res);
  return res;
};

const fetched = async (get: Handler) => {
  const res = makeRes();
  await get({ headers: {} } as Partial<Request>, res);
  return res.payload as { state: unknown };
};

describe("grid-state routes", () => {
  beforeEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
  });
  afterEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
  });

  it("reports no saved grid before anything is stored", async () => {
    const { get } = await mount();
    expect(await fetched(get)).toEqual({ state: null });
  });

  // The point of the whole feature: what the desktop saved is what the phone gets.
  it("round-trips the grid a browser saved", async () => {
    const { get, post } = await mount();
    expect((await saved(post, { state: GRID })).payload).toEqual({ ok: true });
    expect(await fetched(get)).toEqual({ state: GRID });
  });

  it("a later save replaces the earlier one (last write wins)", async () => {
    const { get, post } = await mount();
    await saved(post, { state: GRID });
    const next = { cells: [], page: 2, sortMode: "auto" };
    await saved(post, { state: next });
    expect(await fetched(get)).toEqual({ state: next });
  });

  // Without the publish, two open browsers each hold their own grid and drift apart — the bug
  // the live channel exists to prevent.
  it("publishes the saved grid so other browsers apply it live", async () => {
    const { post, publish, channel } = await mount();
    await saved(post, { state: GRID });
    expect(publish).toHaveBeenCalledWith(channel, GRID);
  });

  it("does not publish anything it refused to store", async () => {
    const { post, publish } = await mount();
    await saved(post, { state: { nope: true } });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a write from a disallowed origin", async () => {
    const { post, publish } = await mount({ isAllowedOrigin: () => false });
    const res = await saved(post, { state: GRID }, "http://evil.example");
    expect(res.statusCode).toBe(403);
    expect(publish).not.toHaveBeenCalled();
    expect(await fs.access(STATE_FILE).catch(() => "gone")).toBe("gone");
  });

  it("rejects a body that is not a grid (no cells array)", async () => {
    const { post } = await mount();
    for (const body of [{ state: { cells: "nope" } }, { state: [] }, { state: null }, {}, undefined]) {
      expect((await saved(post, body)).statusCode).toBe(400);
    }
  });

  it("rejects a grid too large to be one", async () => {
    const { post } = await mount();
    const huge = { cells: [{ uid: 0, note: "x".repeat(300 * 1024) }] };
    expect((await saved(post, { state: huge })).statusCode).toBe(413);
  });

  // A truncated or hand-broken file must read as "no saved grid", not as something the client
  // has to defend itself against.
  it("treats a corrupt state file as no saved grid", async () => {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, '{"cells": [truncated');
    const { get } = await mount();
    expect(await fetched(get)).toEqual({ state: null });
  });

  it("treats a well-formed file that is not a grid as no saved grid", async () => {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify({ page: 1 }));
    const { get } = await mount();
    expect(await fetched(get)).toEqual({ state: null });
  });

  it("a saved grid survives a restart", async () => {
    const first = await mount();
    await saved(first.post, { state: GRID });
    const restarted = await mount();
    expect(await fetched(restarted.get)).toEqual({ state: GRID });
  });
});
