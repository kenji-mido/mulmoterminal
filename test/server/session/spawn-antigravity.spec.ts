// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAntigravitySpawner } from "../../../server/session/spawn-antigravity.js";
import { ptys } from "../../../server/session/registry.js";
import type { SpawnDeps } from "../../../server/session/spawn-deps.js";
import { cleanupSessionSettings } from "../../../server/session/session-settings.js";

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: vi.fn((_id: string, _bin: string, args: string[]) => {
    spawnMocks.argv.push(args);
    return {
      term: {
        pid: 1234,
        onData: vi.fn(),
        onExit: vi.fn(),
      },
      tmux: false,
    };
  }),
  // This spawn really starts agy, so it is the branch that syncs the directory's MCP config (#1443).
  ptyWouldReattach: vi.fn(() => false),
}));

const CAPTURED_ID = "1c0f5b2e-9d84-4f21-a7c3-6b5e8d9a0f14";

// The watcher polls agy's real brain root for half an hour, and `remember` appends to the real
// ~/.mulmoterminal log. Both are stubbed: this file is about what the spawner does with a capture,
// and a unit test must not write a session that never existed into the developer's own state.
const mocks = vi.hoisted(() => ({ remembered: [] as { sessionId: string; conversationId: string; cwd: string }[] }));
// The argv each spawn really handed the pty — the only place the seed wiring can be seen end to end.
const spawnMocks = vi.hoisted(() => ({ argv: [] as string[][] }));

vi.mock("../../../server/agents/antigravity-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/antigravity-session.js")>()),
  watchForAntigravitySession: vi.fn(() => Promise.resolve(CAPTURED_ID)),
}));

vi.mock("../../../server/session/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/registry.js")>()),
  rememberAntigravityConversation: vi.fn((sessionId: string, conversationId: string, cwd: string) => {
    mocks.remembered.push({ sessionId, conversationId, cwd });
  }),
}));

describe("createAntigravitySpawner", () => {
  const publishActivity = vi.fn();
  const dummyDeps = {
    antigravityBin: "agy",
    antigravityModel: null,
    outputBufferLimit: 10000,
    reap: vi.fn(),
    publishActivity,
  } as unknown as SpawnDeps;

  beforeEach(() => {
    ptys.clear();
    mocks.remembered.length = 0;
    spawnMocks.argv.length = 0;
    publishActivity.mockClear();
  });

  it("spawns an antigravity PTY entry and registers it in ptys registry", () => {
    const { spawnAntigravityPty } = createAntigravitySpawner(dummyDeps);
    const entry = spawnAntigravityPty("session-1", null, null, "/test/dir", { mcpGroups: [] });

    expect(entry.agent).toBe("antigravity");
    expect(entry.cwd).toBe("/test/dir");
    expect(ptys.get("session-1")).toBe(entry);
  });

  // The seed wiring, through the REAL spawner rather than through the argument builder: a test that
  // calls seedPromptArgument itself would still pass if this spawner stopped calling it (#1518).
  //
  // Forced to win32 so the branch under test is the one that cannot work — on this machine's own
  // platform a multi-line seed is passed straight through and there is nothing to see.
  it("hands the pty a single-line seed reference on Windows, never the multi-line seed", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      const { spawnAntigravityPty } = createAntigravitySpawner(dummyDeps);
      spawnAntigravityPty("11111111-2222-4333-8444-555555555555", null, null, "/test/dir", {
        mcpGroups: [],
        initialPrompt: 'Use the "x" skill.\n\nand do the thing',
      });
      const args = spawnMocks.argv.at(-1) ?? [];
      expect(args.filter((arg) => /[\0\r\n]/.test(arg))).toEqual([]);
      expect(args.some((arg) => arg.includes("-seed.txt"))).toBe(true);
    } finally {
      platform.mockRestore();
      cleanupSessionSettings("11111111-2222-4333-8444-555555555555");
    }
  });

  // Without this the cell keeps the header badge it was given before agy had a conversation at all,
  // for the whole session: an agy session has no hooks and no activity tracker, so it never
  // finishes a turn, and a finished turn is the cell's only other reason to re-read its badges.
  it("publishes once the conversation id is captured, so the cell re-reads its model badge", async () => {
    const { spawnAntigravityPty } = createAntigravitySpawner(dummyDeps);
    spawnAntigravityPty("session-2", null, null, "/test/dir", { mcpGroups: [] });
    await vi.waitFor(() => expect(mocks.remembered).toHaveLength(1));

    expect(mocks.remembered[0]).toEqual({ sessionId: "session-2", conversationId: CAPTURED_ID, cwd: "/test/dir" });
    expect(publishActivity).toHaveBeenCalledWith("session-2");
  });

  // A resumed session knows its conversation at spawn, so the seed fetch already reads the right
  // transcript — and the watcher is not run at all, which is what keeps a concurrent conversation
  // from being mis-attributed to it.
  it("does not run the watcher for a resumed conversation", async () => {
    const { spawnAntigravityPty } = createAntigravitySpawner(dummyDeps);
    spawnAntigravityPty("session-3", null, CAPTURED_ID, "/test/dir", { mcpGroups: [] });
    await vi.waitFor(() => expect(mocks.remembered).toHaveLength(1));

    expect(mocks.remembered[0]?.conversationId).toBe(CAPTURED_ID);
    expect(publishActivity).not.toHaveBeenCalled();
  });
});
