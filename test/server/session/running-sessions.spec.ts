// @vitest-environment node
// What the launcher's rows are told is still RUNNING (#1467).
//
// The question `attached` cannot answer: it is computed from `tmux list-clients`, which reports
// only sessions that HAVE a client — so a session running with nobody attached, the one a server
// restart leaves behind and the one that piles up, is missing from it entirely. These two pieces
// are what the stop button is aimed with, hence pinning them rather than the route around them.
import { describe, it, expect, vi, beforeEach } from "vitest";

const listSessionIds = vi.fn<() => string[]>(() => []);
vi.mock("../../../server/infra/tmux.js", () => ({ tmuxListSessionIds: () => listSessionIds() }));

const { runningKeyOf, runningSessionKeys } = await import("../../../server/session/dir-session.js");
const { ptys } = await import("../../../server/session/registry.js");

const fakePty = (id: string) => {
  // Only the map's key is read here; the entry stands in for a live pty.
  ptys.set(id, { cwd: "/repo", agent: "claude" } as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

beforeEach(() => {
  listSessionIds.mockReturnValue([]);
  ptys.clear();
});

describe("runningSessionKeys", () => {
  it("has nothing when no tmux session survived and no pty is live", () => {
    expect([...runningSessionKeys()]).toEqual([]);
  });

  it("counts a tmux session nobody is attached to — the case list-clients cannot report", () => {
    listSessionIds.mockReturnValue(["survivor"]);
    expect(runningSessionKeys().has("survivor")).toBe(true);
  });

  // Without tmux nothing outlives a restart, but a pty in THIS process is still running: a browser
  // tab closed on a working session leaves exactly that, and it is stoppable.
  it("counts a live pty in this process", () => {
    fakePty("live-1");
    expect(runningSessionKeys().has("live-1")).toBe(true);
  });

  it("counts a session that is both, once", () => {
    listSessionIds.mockReturnValue(["both"]);
    fakePty("both");
    expect([...runningSessionKeys()]).toEqual(["both"]);
  });
});

describe("runningKeyOf", () => {
  it("is null when none of the row's keys is running", () => {
    expect(runningKeyOf(["a", "b"], new Set(["c"]))).toBeNull();
  });

  it("is the row's own id when that is what runs — claude's key IS its conversation id", () => {
    expect(runningKeyOf(["s-9"], new Set(["s-9"]))).toBe("s-9");
  });

  // The reason this takes a LIST: a codex/agy conversation started from a grid cell runs under a
  // key MulmoTerminal minted, and only that agent's conversation log connects the two. Aiming the
  // stop button at the row's id would kill nothing and report success.
  it("is the minted session key when the conversation id is not what runs", () => {
    expect(runningKeyOf(["conversation-1", "mt-key-2"], new Set(["mt-key-2"]))).toBe("mt-key-2");
  });

  it("prefers the row's own id when both are running", () => {
    expect(runningKeyOf(["s-9", "mt-key-2"], new Set(["mt-key-2", "s-9"]))).toBe("s-9");
  });
});
