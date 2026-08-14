// @vitest-environment node
//
// muse's GUI MCP has two halves, and they live in different places on purpose — this pins the join.
//
// The REGISTRATION is machine-wide: `muse plugins install` copies the bundle into a
// content-addressed cache and records it for the user, with no per-directory form (measured). So
// the plugin declares every tool group, always, and installing it says nothing about which
// directory may use what.
//
// The ENTITLEMENT is per session, and it is RECORDED rather than exported: a plugin's MCP server
// is started with a curated environment carrying nothing of ours (measured), so the bridge resolves
// its own session against this server and is told the groups with the answer. That is what keeps
// the launcher's per-directory switches meaningful for an agent whose registration cannot honour
// them.
//
// Get the join wrong in either direction and it is silent: a session that carries no groups shows
// no tools with nothing logged, and one that carries groups the directory never registered hands a
// cell tools its neighbours were not given.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupSessionSettings } from "../../../server/session/session-settings.js";

const ID = "11111111-2222-4333-8444-555555555555";
const CWD = "/home/me/project";

let reattaching = false;
const syncMuseMcpPlugin = vi.fn();
const spawned: { env: Record<string, string> | undefined }[] = [];
// The argv each spawn really handed the pty — where the seed wiring is visible end to end.
const spawnedArgv: string[][] = [];

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: (_id: string, _bin: string, args: string[], _cwd: string, _tmux: boolean, options: { env?: Record<string, string> }) => {
    spawned.push({ env: options?.env });
    spawnedArgv.push(args);
    return { term: fakeTerm(), tmux: true, reattached: reattaching };
  },
  ptyWouldReattach: () => reattaching,
}));

vi.mock("../../../server/agents/muse-mcp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/muse-mcp.js")>()),
  syncMuseMcpPlugin: () => syncMuseMcpPlugin(),
}));

vi.mock("../../../server/session/registry.js", () => ({
  ptys: new Map(),
  claimedMuseSessions: new Set(),
  rememberMuseSession: vi.fn(),
}));

vi.mock("../../../server/session/pty-relay.js", () => ({ wireAgentPtyRelay: vi.fn() }));

const rememberEntitledToolGroups = vi.fn();
let recorded: readonly string[] = [];
vi.mock("../../../server/session/bridge-session.js", () => ({
  rememberEntitledToolGroups: (id: string, groups: readonly string[]) => rememberEntitledToolGroups(id, groups),
  entitledToolGroups: () => recorded,
}));
vi.mock("../../../server/agents/muse-session.js", () => ({
  snapshotMuseSessions: () => Promise.resolve(new Set<string>()),
  watchForMuseSession: () => Promise.resolve(null),
}));

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

const { createMuseSpawner } = await import("../../../server/session/spawn-muse.js");

const deps = { museBin: "muse", museModel: null, publishActivity: vi.fn() } as unknown as Parameters<typeof createMuseSpawner>[0];
const spawn = (groups: readonly string[]) => createMuseSpawner(deps).spawnMusePty(ID, null, null, CWD, { mcpGroups: groups as never });

const lastEnv = () => spawned[spawned.length - 1]?.env ?? {};

describe("spawnMusePty and the machine-wide plugin", () => {
  beforeEach(() => {
    reattaching = false;
    spawned.length = 0;
    syncMuseMcpPlugin.mockClear();
  });

  it("registers the plugin when it really starts muse", () => {
    spawn(["render"]);
    expect(syncMuseMcpPlugin).toHaveBeenCalledTimes(1);
  });

  // NOT the rule the two file-writing agents follow, and the difference is the point. Their file is
  // shared by every session in the directory, so writing it on a reattach speaks for terminals this
  // spawn knows nothing about. muse's registration is machine-wide and inert on its own, so there
  // is nothing to protect — and skipping it here is what made the feature look broken on the day it
  // landed: sessions outlive the server, so every muse cell was a reattach, none of them registered
  // anything, and restarting the server changed nothing (2026-08-06).
  it("registers on a tmux reattach too, so the next start of that session has the tools", () => {
    reattaching = true;
    spawn(["render"]);
    expect(syncMuseMcpPlugin).toHaveBeenCalledTimes(1);
  });

  // Deliberately NOT gated on having a group: the registration is inert until a session's own
  // entitlement says otherwise, so a directory switching its first group on mid-session must not
  // have to wait for a later spawn that happens to have one already.
  it("registers even for a directory that has switched nothing on", () => {
    spawn([]);
    expect(syncMuseMcpPlugin).toHaveBeenCalledTimes(1);
  });
});

describe("spawnMusePty and the session's entitlement", () => {
  beforeEach(() => {
    reattaching = false;
    recorded = [];
    spawned.length = 0;
    syncMuseMcpPlugin.mockClear();
    rememberEntitledToolGroups.mockClear();
  });

  // A reattach reaches the spawner too, and the muse in that pane is already running with what it
  // read at its own start — so re-recording could only move the entitlement of a session that
  // cannot act on the change, from a reconnect that may not even carry the right directory.
  it("does not re-record for a session it is only reattaching", () => {
    reattaching = true;
    recorded = ["render"];
    spawn(["media"]);
    expect(rememberEntitledToolGroups).not.toHaveBeenCalled();
  });

  // Unless this process knows nothing about it — the server-restart case, where the record is the
  // only answer the bridge can be given at all.
  it("records for a reattached session this process has no record of", () => {
    reattaching = true;
    recorded = [];
    spawn(["render"]);
    expect(rememberEntitledToolGroups).toHaveBeenCalledWith(ID, ["render"]);
  });

  it("records exactly the groups the directory registered, against this session", () => {
    spawn(["render", "media"]);
    expect(rememberEntitledToolGroups).toHaveBeenCalledWith(ID, ["render", "media"]);
  });

  // An empty list is a real answer, not a missing one — every server stands down, which is what a
  // muse cell in an unregistered directory had before any of this.
  it("records an empty list for a directory that registered nothing", () => {
    spawn([]);
    expect(rememberEntitledToolGroups).toHaveBeenCalledWith(ID, []);
  });

  // The whole feature is behind muse's experimental flag. This one IS an environment variable,
  // because it is read by the muse process itself — which does inherit our spawn environment —
  // rather than by the plugin server, which inherits nothing.
  it("turns muse's plugin support on for the session", () => {
    spawn(["render"]);
    expect(lastEnv().MUSE_EXPERIMENTAL_PLUGINS).toBe("1");
  });

  // And nothing else: a variable set here for the BRIDGE would be dropped on the way, which is the
  // mistake this design replaced. If one is ever added, it is for muse itself.
  it("does not pretend the bridge can be told anything through the environment", () => {
    spawn(["render"]);
    expect(lastEnv().MULMOTERMINAL_SESSION_ID).toBeUndefined();
    expect(lastEnv().MULMOTERMINAL_TOOL_GROUPS).toBeUndefined();
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
      createMuseSpawner(deps).spawnMusePty(ID, null, null, CWD, { mcpGroups: [] as never, initialPrompt: 'Use the "x" skill.\n\nand do the thing' });
      const args = spawnedArgv.at(-1) ?? [];
      expect(args.filter((arg) => /[\0\r\n]/.test(arg))).toEqual([]);
      expect(args.some((arg) => arg.includes("-seed.txt"))).toBe(true);
    } finally {
      platform.mockRestore();
      cleanupSessionSettings(ID);
    }
  });
});
