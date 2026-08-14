// @vitest-environment node
//
// grok's MCP registration is written per DIRECTORY (`.grok/config.toml`), so it is shared by every
// grok session running there — and a REATTACH must not touch it.
//
// spawnGrokPty is reached by both paths: a genuinely new grok, and the one ws-routes comes back
// through after the server restarts while the tmux session (and its grok) kept running. The grok in
// that pane read the file once, at its own start; nothing re-reads it. So a rewrite on a reattach
// cannot affect the process being reattached — it can only speak for the OTHER sessions in the
// directory.
//
// The damaging case is not hypothetical. The caller resolves the groups with `.catch(() => [])`, so
// a transient failure reading Claude Code's config arrives here as "no groups", and an unconditional
// sync would then DEREGISTER the servers every live grok in that directory is using — leaving them
// with no GUI tools until something else re-registered them. (Codex review, #1441.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupSessionSettings } from "../../../server/session/session-settings.js";

const ID = "11111111-2222-4333-8444-555555555555";
const CWD = "/home/me/project";

let reattaching = false;
const syncGrokMcpConfig = vi.fn();
// The argv each spawn really handed the pty — where the seed wiring is visible end to end.
const spawnedArgv: string[][] = [];

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: (_id: string, _bin: string, args: string[]) => {
    spawnedArgv.push(args);
    return { term: fakeTerm(), tmux: true, reattached: reattaching };
  },
  ptyWouldReattach: () => reattaching,
}));

vi.mock("../../../server/agents/grok-mcp.js", () => ({
  syncGrokMcpConfig: (cwd: string, groups: readonly string[]) => syncGrokMcpConfig(cwd, groups),
}));

vi.mock("../../../server/session/registry.js", () => ({ ptys: new Map() }));

// The relay wires activity/output plumbing this spec is not about, and it would reach the pubsub.
vi.mock("../../../server/session/pty-relay.js", () => ({ wireAgentPtyRelay: vi.fn() }));

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

const { createGrokSpawner } = await import("../../../server/session/spawn-grok.js");

const deps = { grokBin: "grok", grokModel: null } as unknown as Parameters<typeof createGrokSpawner>[0];
const spawn = (groups: readonly string[]) => createGrokSpawner(deps).spawnGrokPty(ID, null, null, CWD, { mcpGroups: groups as never });

describe("spawnGrokPty and the directory's shared .grok/config.toml", () => {
  beforeEach(() => {
    reattaching = false;
    syncGrokMcpConfig.mockClear();
  });

  it("registers the directory's groups when it really starts grok", () => {
    spawn(["render"]);
    expect(syncGrokMcpConfig).toHaveBeenCalledWith(CWD, ["render"]);
  });

  it("does not touch the file when tmux will reattach an already-running grok", () => {
    reattaching = true;
    spawn(["render"]);
    expect(syncGrokMcpConfig).not.toHaveBeenCalled();
  });

  // The specific harm, stated as its own case: an empty group list on a reattach is the shape a
  // failed config read takes, and it must not reach the file.
  it("does not deregister everything when a reattach arrives with no groups resolved", () => {
    reattaching = true;
    spawn([]);
    expect(syncGrokMcpConfig).not.toHaveBeenCalled();
  });
});

// The seed wiring, through the REAL spawner rather than through the argument builder: a test that
// calls seedPromptArgument itself would still pass if this spawner stopped calling it (#1518).
//
// Forced to win32 so the branch under test is the one that cannot work — on this machine's own
// platform a multi-line seed is passed straight through and there is nothing to see.
describe("the seed a Windows spawn hands the pty", () => {
  it("is a single-line file reference, never the multi-line seed", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      createGrokSpawner(deps).spawnGrokPty(ID, null, null, CWD, { mcpGroups: [] as never, initialPrompt: 'Use the "x" skill.\n\nand do the thing' });
      const args = spawnedArgv.at(-1) ?? [];
      expect(args.filter((arg) => /[\0\r\n]/.test(arg))).toEqual([]);
      expect(args.some((arg) => arg.includes("-seed.txt"))).toBe(true);
    } finally {
      platform.mockRestore();
      cleanupSessionSettings(ID);
    }
  });
});
