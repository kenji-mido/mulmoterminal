// What the browser does with the three outcomes (#1219). The one that matters is `resumed`: that
// session was already working on this issue and NOTHING was typed into it, so a cell told to
// expect a draft would sit waiting for an Enter with no text behind it.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { registerSpawnedChatHandler, resetSpawnedChatQueue, type SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";
import { useIssueStart } from "../../../src/composables/useIssueStart";
import type { RepoDirs } from "../../../common/repoDirs";

const { repoDirs, startIssueWork, startError } = useIssueStart();

const placed: SpawnedChatRequest[] = [];
let unregister: () => void = () => {};

const answer = (body: unknown, ok = true) =>
  vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as unknown as Response)) as unknown as typeof fetch;

const entry = (): RepoDirs => ({ repo: "acme/web", dirs: [{ path: "/w/web", label: "web", orderPriority: null }], primary: "/w/web" });

beforeEach(() => {
  placed.length = 0;
  resetSpawnedChatQueue();
  unregister = registerSpawnedChatHandler((req) => {
    placed.push(req);
    return true;
  });
  repoDirs.value = [entry()];
  startError.value = null;
});
afterEach(() => unregister());

describe("what the row does with the server's outcome", () => {
  it("expects a draft for a freshly started issue", async () => {
    globalThis.fetch = answer({ ok: true, sessionId: "s-1", outcome: "created" });
    expect(await startIssueWork("acme/web", 7, "/w/web")).toBe(true);
    expect(placed).toEqual([{ id: "s-1", agent: "claude", draft: true }]);
  });

  // Same as created: the worktree was already there but empty, so the issue IS in the box.
  it("expects a draft when an empty existing worktree was reused", async () => {
    globalThis.fetch = answer({ ok: true, sessionId: "s-2", outcome: "reused" });
    await startIssueWork("acme/web", 7, "/w/web");
    expect(placed[0]).toMatchObject({ id: "s-2", draft: true });
  });

  it("does NOT expect a draft when the issue's own session was reopened", async () => {
    globalThis.fetch = answer({ ok: true, sessionId: "s-old", outcome: "resumed" });
    await startIssueWork("acme/web", 7, "/w/web");
    expect(placed[0]).toMatchObject({ id: "s-old", draft: false });
  });

  // A server that predates the field: the ordinary case is a draft, which is what every start did
  // before the three outcomes existed.
  it("expects a draft when the server said nothing about the outcome", async () => {
    globalThis.fetch = answer({ ok: true, sessionId: "s-3" });
    await startIssueWork("acme/web", 7, "/w/web");
    expect(placed[0]).toMatchObject({ draft: true });
  });

  // The REAL shape the route sends for a step that ran and stopped: `{ ok: false, reason, detail }`
  // — no `error` key. Reading only `error` showed "could not start work on acme/web#7" and dropped
  // the one sentence that says what to do, which is the whole point of refusing rather than
  // starting a second worktree.
  it("shows the refusal and places nothing when the worktree is held elsewhere", async () => {
    const detail = "this worktree's session is open in another terminal — a worktree runs one session, so close it there first";
    globalThis.fetch = answer({ ok: false, reason: "worktree-busy", detail }, false);
    expect(await startIssueWork("acme/web", 7, "/w/web")).toBe(false);
    expect(placed).toEqual([]);
    expect(startError.value).toBe(detail);
  });

  // The other shape, from the guards that reject the request outright.
  it("shows the guard's error when the request itself was refused", async () => {
    globalThis.fetch = answer({ error: "/etc is not a known clone of acme/web" }, false);
    await startIssueWork("acme/web", 7, "/w/web");
    expect(startError.value).toBe("/etc is not a known clone of acme/web");
  });

  it("falls back to a sentence of its own when the server said neither", async () => {
    globalThis.fetch = answer({ ok: false }, false);
    await startIssueWork("acme/web", 7, "/w/web");
    expect(startError.value).toBe("could not start work on acme/web#7");
  });
});
