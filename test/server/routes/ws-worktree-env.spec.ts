// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PtyEntry } from "../../../server/session/types.js";

const ensureWorktreeEnv = vi.fn(() => Promise.resolve({ PORT: "3010" }));
vi.mock("../../../server/config/worktree-env.js", () => ({ ensureWorktreeEnv }));

// tmux is what tells a SURVIVED session apart from a fresh one, and it is a real process on the
// host — stubbed so this asks the question rather than the machine.
let tmuxSessions = new Set<string>();
vi.mock("../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/tmux.js")>()),
  tmuxAvailable: () => true,
  tmuxHasSession: (id: string) => tmuxSessions.has(id),
}));

const { reserveWorktreeEnvForSpawn } = await import("../../../server/routes/ws-routes.js");

const WORKTREE = "/repo/worktrees/fix-login";
const livePty = { cwd: WORKTREE } as unknown as PtyEntry;

beforeEach(() => {
  ensureWorktreeEnv.mockClear();
  tmuxSessions = new Set();
});

// A reattach starts no process, so nothing would read a reservation — and its `?cwd=` is the least
// trustworthy field in the request: absent, it falls back to the default workspace. Reserving
// there would hand a port to a directory nobody is launching in. (Codex review, #1367.)
describe("reserveWorktreeEnvForSpawn", () => {
  it("reserves for a connection that is about to spawn", async () => {
    await reserveWorktreeEnvForSpawn(WORKTREE, { id: "s1", live: undefined });
    expect(ensureWorktreeEnv).toHaveBeenCalledWith(WORKTREE);
  });

  it("reserves nothing when a live pty is being reattached", async () => {
    await reserveWorktreeEnvForSpawn("/some/workspace/fallback", { id: "s1", live: livePty });
    expect(ensureWorktreeEnv).not.toHaveBeenCalled();
  });

  // The half a `!live` test misses: a session that outlived the server is picked up from tmux with
  // no same-process pty at all, so it looks exactly like a fresh spawn until tmux is asked.
  it("reserves nothing when a SURVIVING tmux session is being reattached", async () => {
    tmuxSessions.add("s1");
    await reserveWorktreeEnvForSpawn("/some/workspace/fallback", { id: "s1", live: undefined });
    expect(ensureWorktreeEnv).not.toHaveBeenCalled();
  });

  // /ws/run has no session identity and never reattaches, so it always spawns.
  it("always reserves for an ephemeral run terminal", async () => {
    tmuxSessions.add("s1");
    await reserveWorktreeEnvForSpawn(WORKTREE, null);
    expect(ensureWorktreeEnv).toHaveBeenCalledWith(WORKTREE);
  });
});
