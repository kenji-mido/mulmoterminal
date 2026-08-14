// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { Express } from "express";
import { mountTmuxRoutes, type TmuxRouteDeps } from "../../../server/infra/tmux-routes.js";

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

type Handler = (req: { headers: { origin?: string }; params: { id?: string } }, res: FakeRes) => unknown;
type MountedHandler = (req: { headers: { origin?: string }; params: { id?: string }; method: string; path: string }, res: FakeRes) => unknown;

// Mount with the given deps and hand back the two handlers by path — no HTTP server
// needed (mirrors gitRemote.spec's capture pattern). The captured handler is wrapped to
// carry the method and path Express would have set: the origin guard reads both, since it
// is the same rule the central gate applies (a safe method is never judged by origin).
function mountAndCapture(deps: TmuxRouteDeps): { terminate: Handler; cleanup: Handler; surviving: Handler; hide: Handler; del: Handler } {
  const handlers = new Map<string, Handler>();
  const app = {
    post: (p: string, h: MountedHandler) => handlers.set(p, (req, res) => h({ ...req, method: "POST", path: p }, res)),
    // The surviving-sessions listing is a GET (#1478); it is judged by the same origin rule, so it
    // is captured the same way rather than left out of this harness.
    get: (p: string, h: MountedHandler) => handlers.set(p, (req, res) => h({ ...req, method: "GET", path: p }, res)),
  } as unknown as Express;
  mountTmuxRoutes(app, deps);
  const terminate = handlers.get("/api/session/:id/terminate");
  const cleanup = handlers.get("/api/tmux/cleanup-orphans");
  const surviving = handlers.get("/api/tmux/sessions");
  const hide = handlers.get("/api/session/:id/hide");
  const del = handlers.get("/api/session/:id/delete");
  if (!terminate || !cleanup || !surviving || !hide || !del) throw new Error("routes were not mounted");
  return { terminate, cleanup, surviving, hide, del };
}

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

function baseDeps(over: Partial<TmuxRouteDeps> = {}): TmuxRouteDeps {
  return {
    isAllowedOrigin: () => true,
    isValidSessionId: (id) => id === UUID,
    reapSession: vi.fn(),
    hasTmux: () => false,
    killTmux: vi.fn(),
    hideSession: vi.fn(),
    deleteTranscripts: vi.fn(() => true),
    sweep: () => ({ reaped: [], heldBack: 0, recent: 0, unclear: 0 }),
    survivingSessions: async () => [],
    ...over,
  };
}

describe("mountTmuxRoutes — POST /api/session/:id/hide and /delete", () => {
  it("hide persists the hide and reaps, but never touches the transcript", async () => {
    const hideSession = vi.fn();
    const deleteTranscripts = vi.fn(() => true);
    const reapSession = vi.fn();
    const { hide } = mountAndCapture(baseDeps({ hideSession, deleteTranscripts, reapSession }));
    const res = makeRes();
    await hide({ headers: {}, params: { id: UUID } }, res);
    expect(hideSession).toHaveBeenCalledWith(UUID);
    expect(reapSession).toHaveBeenCalledWith(UUID);
    expect(deleteTranscripts).not.toHaveBeenCalled();
    expect(res.payload).toEqual({ ok: true });
  });

  it("delete waits for the tmux session to be gone before unlinking — a dying agent's last flush must not resurrect the row", async () => {
    vi.useFakeTimers();
    try {
      const deleteTranscripts = vi.fn(() => true);
      let hasTmuxCalls = 0;
      // Call 1 is the direct-kill check; the poll then sees it alive twice before it's gone.
      const { del } = mountAndCapture(baseDeps({ deleteTranscripts, hasTmux: () => ++hasTmuxCalls <= 3 }));
      const res = makeRes();
      const done = del({ headers: {}, params: { id: UUID } }, res) as Promise<unknown>;
      expect(deleteTranscripts).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100); // poll 1: still alive
      expect(deleteTranscripts).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100); // poll 2: gone -> unlink
      await done;
      expect(deleteTranscripts).toHaveBeenCalledTimes(1);
      expect(res.payload).toEqual({ ok: true, removed: true });
      await vi.advanceTimersByTimeAsync(2000); // the straggler sweep re-deletes
      expect(deleteTranscripts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delete on an already-idle session (no tmux) unlinks immediately", async () => {
    vi.useFakeTimers();
    try {
      const deleteTranscripts = vi.fn(() => false);
      const { del } = mountAndCapture(baseDeps({ deleteTranscripts, hasTmux: () => false }));
      const res = makeRes();
      await del({ headers: {}, params: { id: UUID } }, res);
      expect(deleteTranscripts).toHaveBeenCalledTimes(1);
      expect(res.payload).toEqual({ ok: true, removed: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mountTmuxRoutes — POST /api/session/:id/terminate", () => {
  it("rejects a disallowed origin with 403 and reaps nothing", async () => {
    const reapSession = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, reapSession }));
    const res = makeRes();
    await terminate({ headers: { origin: "https://evil.example" }, params: { id: UUID } }, res);
    expect(res.statusCode).toBe(403);
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid session id with 400 and reaps nothing", async () => {
    const reapSession = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ reapSession }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: "not-a-uuid" } }, res);
    expect(res.statusCode).toBe(400);
    expect(reapSession).not.toHaveBeenCalled();
  });

  it("reaps the session and kills a leftover tmux orphan", async () => {
    const reapSession = vi.fn();
    const killTmux = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ reapSession, killTmux, hasTmux: () => true }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(reapSession).toHaveBeenCalledWith(UUID);
    expect(killTmux).toHaveBeenCalledWith(UUID); // tmux still present after reap → killed directly
    expect(res.payload).toEqual({ ok: true });
  });

  it("does not kill tmux directly when reap already removed it", async () => {
    const killTmux = vi.fn();
    const { terminate } = mountAndCapture(baseDeps({ killTmux, hasTmux: () => false }));
    const res = makeRes();
    await terminate({ headers: {}, params: { id: UUID } }, res);
    expect(killTmux).not.toHaveBeenCalled();
    expect(res.payload).toEqual({ ok: true });
  });
});

describe("mountTmuxRoutes — POST /api/tmux/cleanup-orphans", () => {
  const swept = { reaped: ["orphan-1", "orphan-2"], heldBack: 1, recent: 3, unclear: 0 };

  it("rejects a disallowed origin with 403 and sweeps nothing", async () => {
    const sweep = vi.fn(() => swept);
    const { cleanup } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, sweep }));
    const res = makeRes();
    await cleanup({ headers: { origin: "https://evil.example" }, params: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(sweep).not.toHaveBeenCalled();
  });

  // The route no longer carries the decision. It used to select orphans itself against
  // `isResumableTmuxSession` — a predicate made of permanent records, which is why it ended almost
  // nothing (#1467). One rule now, in session/reap-idle-sessions.ts, and it is the same one the
  // server runs at boot; what is pinned here is that the route reports it faithfully.
  it("answers with exactly what the sweep ended", async () => {
    const { cleanup } = mountAndCapture(baseDeps({ sweep: () => swept }));
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ killed: ["orphan-1", "orphan-2"], killedCount: 2 });
  });

  it("says it ended nothing rather than failing when everything is in use", async () => {
    const { cleanup } = mountAndCapture(baseDeps({ sweep: () => ({ reaped: [], heldBack: 4, recent: 0, unclear: 0 }) }));
    const res = makeRes();
    await cleanup({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ killed: [], killedCount: 0 });
  });
});

// The Settings list's own route (#1478). Read-only, and still judged by origin: it names every
// directory this machine has agents in, which is not something a page from elsewhere may read.
describe("mountTmuxRoutes — GET /api/tmux/sessions", () => {
  const ROW = { key: "s-1", cwd: "/repo", agent: "claude" as const, idleSeconds: 60, attached: false, resumable: true, reapable: false };

  it("answers with what the builder produced, untouched", async () => {
    const { surviving } = mountAndCapture(baseDeps({ survivingSessions: async () => [ROW] }));
    const res = makeRes();
    await surviving({ headers: {}, params: {} }, res);
    expect(res.payload).toEqual({ sessions: [ROW] });
  });

  // Safe methods are EXEMPT from the origin rule on purpose (same-origin-guard.ts, #1094): a
  // cross-site `<img>` sends no Origin header and neither does a legitimate local fetch, so
  // refusing by origin blocks the second without stopping the first. A page from elsewhere still
  // cannot READ this — that is the browser's job, not ours. Pinned because the opposite reading is
  // the tempting one, and "hardening" it would break the app's own page.
  it("is not refused by origin, the way a state-changing route is", async () => {
    const { surviving, cleanup } = mountAndCapture(baseDeps({ isAllowedOrigin: () => false, survivingSessions: async () => [ROW] }));
    const read = makeRes();
    await surviving({ headers: { origin: "https://elsewhere.example" }, params: {} }, read);
    expect(read.payload).toEqual({ sessions: [ROW] });

    const write = makeRes();
    await cleanup({ headers: { origin: "https://elsewhere.example" }, params: {} }, write);
    expect(write.statusCode).toBe(403);
  });
});
