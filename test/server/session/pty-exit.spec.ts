// @vitest-environment node
// What a dead pty is evidence of (#1496).
//
// Under tmux the pty is the CLIENT, so its death says either "the agent finished" or "something
// killed our client while the agent kept running" — and the exit handlers used to read both as the
// first. The second is what a `signal=9` in the report was: nothing here sends SIGKILL (node-pty's
// `kill()` sends SIGHUP), so it came from outside, and reaping there ends a tmux session with a
// live agent in it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const hasSession = vi.fn<(id: string) => boolean>(() => false);
vi.mock("../../../server/infra/tmux.js", () => ({ tmuxHasSession: (id: string) => hasSession(id) }));

const { ptyExitDisposition, handlePtyExit } = await import("../../../server/session/pty-exit.js");
const { ptys } = await import("../../../server/session/registry.js");

const register = (id: string, tmux: boolean) => {
  // Only `tmux` is read here; the rest of the entry stands in for a live pty.
  ptys.set(id, { tmux, cwd: "/repo", agent: "claude" } as unknown as NonNullable<ReturnType<typeof ptys.get>>);
};

beforeEach(() => {
  ptys.clear();
  // Cleared, not just re-stubbed: the "never asks tmux" assertion below reads the CALL COUNT, and
  // a shared mock carries the previous test's calls into it.
  hasSession.mockClear();
  hasSession.mockReturnValue(false);
});

describe("ptyExitDisposition", () => {
  it("keeps a session whose tmux is still running — only the client died", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: true, tmuxAlive: true })).toBe("keep");
  });

  it("reaps when tmux no longer has the session — the agent really exited", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: true, tmuxAlive: false })).toBe("reap");
  });

  // Without tmux nothing can outlive the pty, so its death is the session's death.
  it("reaps a pty that was never tmux-backed", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: false, tmuxAlive: false })).toBe("reap");
  });

  // The close button reaps first and the pty dies afterwards, so the exit arrives with nothing to
  // act on. Reaping again is harmless, but "gone" is the honest answer and keeps the log quiet.
  it("does nothing for a session that was already torn down", () => {
    expect(ptyExitDisposition({ stillRegistered: false, tmuxBacked: true, tmuxAlive: true })).toBe("gone");
  });
});

describe("handlePtyExit", () => {
  it("does not reap a session tmux still has, and drops the dead pty entry", () => {
    const reap = vi.fn();
    register("s-1", true);
    hasSession.mockReturnValue(true);

    expect(handlePtyExit("s-1", reap)).toBe("keep");
    expect(reap).not.toHaveBeenCalled();
    // The entry MUST go: `ptys.has()` is what every reconnect path reads as "there is a live pty
    // here", so a dead one left behind would be reused instead of reattached.
    expect(ptys.has("s-1")).toBe(false);
  });

  it("reaps when the tmux session went with the program", () => {
    const reap = vi.fn();
    register("s-1", true);
    hasSession.mockReturnValue(false);

    expect(handlePtyExit("s-1", reap)).toBe("reap");
    expect(reap).toHaveBeenCalledWith("s-1");
  });

  // Asked only when it could matter: a non-tmux pty has nothing that could outlive it, and the
  // question shells out to tmux.
  it("does not ask tmux about a pty that was never tmux-backed", () => {
    const reap = vi.fn();
    register("s-1", false);

    expect(handlePtyExit("s-1", reap)).toBe("reap");
    expect(hasSession).not.toHaveBeenCalled();
    expect(reap).toHaveBeenCalledWith("s-1");
  });

  it("neither reaps nor logs for a session that is already gone", () => {
    const reap = vi.fn();
    hasSession.mockReturnValue(true);

    expect(handlePtyExit("never-registered", reap)).toBe("gone");
    expect(reap).not.toHaveBeenCalled();
  });
});
