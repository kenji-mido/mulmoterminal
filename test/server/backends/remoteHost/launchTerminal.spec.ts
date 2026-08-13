// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideLaunchTerminal } from "../../../../server/backends/remoteHost/launchTerminal.js";

const input = (over: Partial<Parameters<typeof decideLaunchTerminal>[0]> = {}) => ({
  agent: "shell",
  sessionId: "abc",
  cwdOf: () => "/repo",
  listenerCount: 1,
  ...over,
});

describe("decideLaunchTerminal", () => {
  it("accepts each of the three kinds the phone may ask for", () => {
    for (const agent of ["shell", "claude", "codex"]) {
      expect(decideLaunchTerminal(input({ agent }))).toEqual({ ok: true, request: { agent, cwd: "/repo" } });
    }
  });

  // The phone names a SESSION; the host answers with the directory. A path from the phone
  // would let a remote client pick where a process starts.
  it("takes the directory from the host, for the session the phone named", () => {
    const decision = decideLaunchTerminal(input({ sessionId: "s1", cwdOf: (id) => (id === "s1" ? "/from/host" : "/wrong") }));
    expect(decision).toEqual({ ok: true, request: { agent: "shell", cwd: "/from/host" } });
  });

  it("refuses an agent that is not one of the three", () => {
    for (const agent of ["bash", "", null, 42, undefined, { agent: "shell" }]) {
      expect(decideLaunchTerminal(input({ agent }))).toEqual({ ok: false, error: expect.stringContaining("shell, claude, codex") });
    }
  });

  it("refuses a missing or non-string session id", () => {
    for (const sessionId of ["", null, undefined, 7]) {
      expect(decideLaunchTerminal(input({ sessionId }))).toEqual({ ok: false, error: "sessionId is required" });
    }
  });

  // A session that outlived a restart lives only in tmux; no PtyEntry remembers its dir, so
  // there is nowhere to start the new terminal.
  it("refuses when the host has no directory for that session", () => {
    const decision = decideLaunchTerminal(input({ sessionId: "gone", cwdOf: () => null }));
    expect(decision).toEqual({ ok: false, error: expect.stringContaining("'gone'") });
  });

  // The grid is browser state. With no tab subscribed nothing can open the cell, and the
  // phone has to be told rather than left believing it worked.
  it("refuses when no browser is listening", () => {
    expect(decideLaunchTerminal(input({ listenerCount: 0 }))).toEqual({ ok: false, error: expect.stringContaining("no MulmoTerminal browser is open") });
  });

  // Order matters: a bad agent is reported as such even when the browser is also missing,
  // so the phone shows the fault the user can actually fix.
  it("reports the request's own fault before the environment's", () => {
    expect(decideLaunchTerminal(input({ agent: "bash", listenerCount: 0 }))).toEqual({
      ok: false,
      error: expect.stringContaining("shell, claude, codex"),
    });
  });

  it("does not consult the host for a request it has already rejected", () => {
    let asked = 0;
    decideLaunchTerminal(
      input({
        agent: "nope",
        cwdOf: () => {
          asked += 1;
          return "/repo";
        },
      }),
    );
    expect(asked).toBe(0);
  });
});
