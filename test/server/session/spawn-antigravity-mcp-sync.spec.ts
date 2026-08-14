// @vitest-environment node
//
// agy's MCP registration is written per DIRECTORY (`.agents/mcp_config.json`), so it is shared by
// every antigravity session running there — and a REATTACH must not touch it.
//
// spawnAntigravityPty is reached by both paths: a genuinely new agy, and the one ws-routes comes
// back through after the server restarts while the tmux session (and its agy) kept running. The agy
// in that pane read the file once, at its own start; nothing re-reads it. So a rewrite on a
// reattach cannot affect the process being reattached — it can only speak for the OTHER sessions in
// the directory.
//
// The damaging case is not hypothetical. The caller resolves the groups with `.catch(() => [])`, so
// a transient failure reading Claude Code's config arrives here as "no groups", and an
// unconditional sync would then CLEAR the entries every live agy in that directory is using —
// leaving them with no GUI tools until something else re-registered them. (#1443; the same fix
// landed for grok in #1441.)
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "sess-antigravity-1";
const CWD = "/home/me/project";

let reattaching = false;
const syncAntigravityMcpConfig = vi.fn();

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: () => ({ term: fakeTerm(), tmux: true, reattached: reattaching }),
  ptyWouldReattach: () => reattaching,
}));

vi.mock("../../../server/agents/antigravity-mcp.js", () => ({
  syncAntigravityMcpConfig: (cwd: string, groups: readonly string[]) => syncAntigravityMcpConfig(cwd, groups),
}));

// The conversation-id watcher reads the real brain directory and would outlive the test.
vi.mock("../../../server/agents/antigravity-session.js", () => ({
  antigravityBrainRoot: () => `${CWD}/.antigravity/brain`,
  snapshotAntigravitySessions: () => new Set<string>(),
  watchForAntigravitySession: () => Promise.resolve(null),
}));

vi.mock("../../../server/session/registry.js", () => ({
  ptys: new Map(),
  claimedAntigravityConversations: new Set<string>(),
  rememberAntigravityConversation: vi.fn(),
}));

// The relay wires activity/output plumbing this spec is not about, and it would reach the pubsub.
vi.mock("../../../server/session/pty-relay.js", () => ({ wireAgentPtyRelay: vi.fn() }));

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

const { createAntigravitySpawner } = await import("../../../server/session/spawn-antigravity.js");

const deps = { antigravityBin: "agy", antigravityModel: null } as unknown as Parameters<typeof createAntigravitySpawner>[0];
const spawn = (groups: readonly string[]) => createAntigravitySpawner(deps).spawnAntigravityPty(ID, null, null, CWD, { mcpGroups: groups as never });

describe("spawnAntigravityPty and the directory's shared .agents/mcp_config.json", () => {
  beforeEach(() => {
    reattaching = false;
    syncAntigravityMcpConfig.mockClear();
  });

  it("registers the directory's groups when it really starts agy", () => {
    spawn(["render"]);
    expect(syncAntigravityMcpConfig).toHaveBeenCalledWith(CWD, ["render"]);
  });

  it("does not touch the file when tmux will reattach an already-running agy", () => {
    reattaching = true;
    spawn(["render"]);
    expect(syncAntigravityMcpConfig).not.toHaveBeenCalled();
  });

  // The specific harm, stated as its own case: an empty group list on a reattach is the shape a
  // failed config read takes, and it must not reach the file.
  it("does not clear everything when a reattach arrives with no groups resolved", () => {
    reattaching = true;
    spawn([]);
    expect(syncAntigravityMcpConfig).not.toHaveBeenCalled();
  });
});
