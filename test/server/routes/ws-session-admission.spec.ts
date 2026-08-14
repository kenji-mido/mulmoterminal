// @vitest-environment node
// The two admission guards #1533 added in front of every reattach.
//
// `wrongEndpointReason`: `ptys` is one table for every agent and nothing on the attach path
// compared the entry's agent to the endpoint — so a claude cell carrying a foreign id (the
// `asTerminalAgent` coercion of an unrecognised persisted agent) reattached whatever ran under it.
//
// `settledEntry`: the live entry used to be snapshotted before the admission awaits (git, the
// filesystem) and used after — a corpse the reap timer had killed in that window was reattached,
// wiring the browser to a dead pty while the next connect spawned a fresh one under the same id.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebSocket } from "ws";
import type { EarlyFrames } from "../../../server/session/early-frames.js";
import type { PtyEntry } from "../../../server/session/types.js";

const { wrongEndpointReason, settledEntry } = await import("../../../server/routes/ws-routes.js");
const { ptys } = await import("../../../server/session/registry.js");

const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const entryOf = (agent: PtyEntry["agent"]): PtyEntry => ({ term: {} as PtyEntry["term"], ws: null, buffer: "", cwd: "/w", tmux: true, active: false, agent });

describe("wrongEndpointReason", () => {
  it("serves an entry to its own endpoint", () => {
    expect(wrongEndpointReason("claude", "claude")).toBeNull();
    expect(wrongEndpointReason("codex", "codex")).toBeNull();
    expect(wrongEndpointReason("muse", "muse")).toBeNull();
  });

  // The launcher's PTYs are recorded as "shell" whatever command line they run — the endpoint and
  // the recording must agree, or every chip reconnect would be refused.
  it("serves a launcher entry to the launch endpoint", () => {
    expect(wrongEndpointReason("launch", "shell")).toBeNull();
  });

  it("refuses a shell entry on the claude endpoint — the coerced-agent case", () => {
    expect(wrongEndpointReason("claude", "shell")).toContain("running shell, not claude");
  });

  it("refuses a muse entry on the claude endpoint", () => {
    expect(wrongEndpointReason("claude", "muse")).toContain("running muse, not claude");
  });

  it("has no opinion for the run endpoint, which owns no sessions", () => {
    expect(wrongEndpointReason("run", "shell")).toBeNull();
  });
});

describe("settledEntry", () => {
  const fakeWs = () => ({ close: vi.fn() }) as unknown as WebSocket & { close: ReturnType<typeof vi.fn> };
  // An OPEN socket, because `closeWithError` sends nothing to one that is not — a refusal tested
  // against the bare `fakeWs` above would pass while delivering no error frame at all.
  const fakeOpenWs = () =>
    ({ close: vi.fn(), send: vi.fn(), OPEN: 1, readyState: 1 }) as unknown as WebSocket & {
      close: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  const fakeEarly = () => ({ discard: vi.fn(), release: vi.fn() }) as unknown as EarlyFrames & { discard: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ptys.delete(SID);
  });

  it("hands back the entry as it stands now — not the resolve-time snapshot", () => {
    const current = entryOf("claude");
    ptys.set(SID, current);
    const settled = settledEntry(fakeWs(), "claude", SID, true, fakeEarly());
    expect(settled?.entry).toBe(current);
  });

  // A competing connect can have spawned the id while this one was still being admitted — the
  // serialized turn then finds it and reattaches, which is what serialization is FOR.
  it("hands back an entry that appeared where the resolve saw none", () => {
    const current = entryOf("claude");
    ptys.set(SID, current);
    expect(settledEntry(fakeWs(), "claude", SID, false, fakeEarly())?.entry).toBe(current);
  });

  it("proceeds to a spawn when there never was an entry", () => {
    const settled = settledEntry(fakeWs(), "claude", SID, false, fakeEarly());
    expect(settled).toEqual({ entry: undefined });
  });

  // The branch the other four do not reach: an ERROR frame, not a plain close. A plain close has
  // the client retry the same mismatched id forever with backoff, and the mismatch is persisted
  // state only the user can act on — so the frame is what ends the loop and says why.
  it("refuses a mismatched agent with an error frame, not a plain close", () => {
    ptys.set(SID, entryOf("muse"));
    const ws = fakeOpenWs();
    const early = fakeEarly();
    expect(settledEntry(ws, "claude", SID, true, early)).toBeNull();
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"error"'));
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("running muse, not claude"));
    expect(ws.close).toHaveBeenCalledOnce();
    expect(early.discard).toHaveBeenCalledOnce();
  });

  // The mismatch is judged on the entry THIS turn finds, so it fires for one a competing connect
  // spawned under the id while this connect was being admitted — not only for a resolve-time one.
  it("refuses a mismatched entry that appeared where the resolve saw none", () => {
    ptys.set(SID, entryOf("codex"));
    const ws = fakeOpenWs();
    expect(settledEntry(ws, "launch", SID, false, fakeEarly())).toBeNull();
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("running codex, not launch"));
  });

  // The reap fired mid-admission: the snapshot is a corpse. A PLAIN close, not an error frame —
  // an error is terminal to the client, a plain close makes it reconnect and resolve the
  // post-reap world afresh.
  it("closes plainly when the resolve-time entry died mid-admission", () => {
    const ws = fakeWs();
    const early = fakeEarly();
    const settled = settledEntry(ws, "claude", SID, true, early);
    expect(settled).toBeNull();
    expect(ws.close).toHaveBeenCalledOnce();
    expect(early.discard).toHaveBeenCalledOnce();
  });
});
