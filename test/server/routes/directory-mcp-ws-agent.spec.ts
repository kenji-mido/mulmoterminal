// @vitest-environment node
//
// agy and grok connect through ONE handler, because they are the same kind of agent: their MCP
// servers come from a file in the DIRECTORY, shared by every session running there, rather than
// from a per-session flag. grok's endpoint arrived as a copy of antigravity's, and the copy is how
// #1441 happened — the reattach rule was fixed on one side while the other went on rewriting a
// file its running sessions were using.
//
// So these assert the two agents TOGETHER on everything they must agree about, and separately on
// the one thing they must not: only antigravity keeps a session -> conversation map on disk, so
// only antigravity waits for it to be read.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

// Resolved by hand, so "did this connection wait?" is a question the test can ask rather than a
// race it has to hope for.
let releaseAntigravityMap: () => void = () => {};
const antigravityMapRead = new Promise<void>((resolve) => {
  releaseAntigravityMap = resolve;
});

const ptys = new Map<string, unknown>();
const sessionCwd = vi.fn((): string | null => null);
vi.mock("../../../server/session/registry.js", () => ({
  ptys,
  sessionCwd: () => sessionCwd(),
  devTerminalCwdsHydrated: Promise.resolve(),
  antigravityConversations: new Map(),
  antigravityConversationsHydrated: antigravityMapRead,
  museConversations: new Map(),
  museConversationsHydrated: Promise.resolve(),
  codexRollouts: new Map(),
  codexRolloutsHydrated: Promise.resolve(),
  customAgentSessionsHydrated: Promise.resolve(),
  markDevTerminalSession: vi.fn(),
  markAttachedSessionPlaced: vi.fn(),
}));

vi.mock("../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/tmux.js")>()),
  tmuxAvailable: () => false,
  tmuxHasSession: () => false,
}));

// muse's index is a sqlite database on the real disk; this spec is about the handler's shape.
const museSessionExistsForCwd = vi.fn(() => Promise.resolve(false));
vi.mock("../../../server/agents/muse-session.js", () => ({ museSessionExistsForCwd }));

// The directory's registered tool groups, read off Claude Code's config files on the real path.
const registeredGuiMcpGroups = vi.fn(() => Promise.resolve(["render"]));
vi.mock("../../../server/infra/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups }));

vi.mock("../../../server/config/worktree-env.js", () => ({
  ensureWorktreeEnv: vi.fn(() => Promise.resolve({})),
  reservedWorktreeEnv: () => ({}),
}));

// A real occupancy read runs git against the cwd; this spec is about the handler's shape.
vi.mock("../../../server/session/worktree-session-limit.js", () => ({
  claimLaunch: () => ({ release: vi.fn(), contended: false }),
  worktreeOccupancy: () => Promise.resolve({ isWorktree: false, session: null }),
}));

const { handleDirectoryMcpAgentConnection, ANTIGRAVITY_WS_AGENT, GROK_WS_AGENT, MUSE_WS_AGENT } = await import("../../../server/routes/ws-routes.js");

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

function fakeWs() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(raw),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  };
}

// The five arguments a directory-MCP spawner is called with, recorded per agent.
const spawnAntigravityPty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const spawnGrokPty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const spawnMusePty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const reattachPty = vi.fn(() => ({ term: fakeTerm(), active: false }));

const makeDeps = () =>
  ({
    spawnAntigravityPty,
    spawnGrokPty,
    spawnMusePty,
    reattachPty,
    handleClientFrame: vi.fn(),
    handleClientClose: vi.fn(),
  }) as never;

const SPAWNERS: Record<string, typeof spawnGrokPty> = { antigravity: spawnAntigravityPty, grok: spawnGrokPty, muse: spawnMusePty };
const spawnerFor = (kind: string) => SPAWNERS[kind] as typeof spawnGrokPty;

let dir = "";
const request = (query = "") => ({ url: `/ws?cwd=${encodeURIComponent(dir)}${query}` });

// All three, so a rule asserted once is asserted for every agent on this handler. Named so a
// failure says which. What muse does with the groups differs (they travel on the session's
// environment rather than into a file in the directory, because its plugin registration is per
// machine) — but THAT it is handed the directory's groups is the same rule, and is asserted here.
const AGENTS = [ANTIGRAVITY_WS_AGENT, GROK_WS_AGENT, MUSE_WS_AGENT];

beforeEach(() => {
  ptys.clear();
  vi.clearAllMocks();
  registeredGuiMcpGroups.mockResolvedValue(["render"]);
  sessionCwd.mockReturnValue(null);
  releaseAntigravityMap();
  dir = mkdtempSync(path.join(tmpdir(), "mt-dirmcp-"));
});
afterEach(() => {
  ptys.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe.each(AGENTS.map((agent) => [agent.kind, agent] as const))("/ws/%s", (kind, agent) => {
  const spawn = () => spawnerFor(kind);

  it("announces the session id before spawning", async () => {
    const ws = fakeWs();
    await handleDirectoryMcpAgentConnection(agent, makeDeps(), ws as unknown as WebSocket, request());
    expect(JSON.parse(ws.sent[0] ?? "{}")).toMatchObject({ type: "session", cwd: dir });
    expect(spawn()).toHaveBeenCalledTimes(1);
  });

  // The whole reason the groups are read in the route rather than in the spawner: the lookup is
  // async and the spawner is not, so a spawn that did not receive them would clear the entries
  // every other session in the directory is using.
  it("hands the spawner the directory's registered tool groups", async () => {
    await handleDirectoryMcpAgentConnection(agent, makeDeps(), fakeWs() as unknown as WebSocket, request());
    expect(spawn()).toHaveBeenCalledWith(expect.any(String), expect.anything(), null, dir, { mcpGroups: ["render"] });
  });

  // A reattach keeps the tools its running process was started with — nothing re-reads the file,
  // so rewriting it could only speak for the other sessions there.
  it("reattaches a live pty instead of spawning, and looks up no groups", async () => {
    const live = { term: fakeTerm(), cwd: dir };
    const session = "11111111-2222-4333-8444-555555555555";
    ptys.set(session, live);
    await handleDirectoryMcpAgentConnection(agent, makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${session}`));
    expect(reattachPty).toHaveBeenCalledTimes(1);
    expect(spawn()).not.toHaveBeenCalled();
    expect(registeredGuiMcpGroups).not.toHaveBeenCalled();
  });

  // `?gui=0` is a grid cell rather than the single view. For these two agents it decides only that
  // — never which tools the session reaches, which is what claude and codex use it for.
  it("marks the session active for the single view and inactive for a grid cell", async () => {
    await handleDirectoryMcpAgentConnection(agent, makeDeps(), fakeWs() as unknown as WebSocket, request());
    expect(spawn().mock.results[0]?.value).toMatchObject({ active: true });
    await handleDirectoryMcpAgentConnection(agent, makeDeps(), fakeWs() as unknown as WebSocket, request("&gui=0"));
    expect(spawn().mock.results[1]?.value).toMatchObject({ active: false });
  });
});

// The one asymmetry, and it is structural: agy mints its own conversation id and this server keeps
// the mapping on disk, so a reconnect arriving mid-read would see an empty map and start a fresh
// conversation under the old session's id. grok takes `--session-id`, keeps no such map, and has
// nothing to wait for.
describe("waiting for the on-disk conversation map", () => {
  it("antigravity resolves nothing until its map has been read", async () => {
    let readable = () => {};
    const pending = new Promise<void>((resolve) => {
      readable = resolve;
    });
    const connection = handleDirectoryMcpAgentConnection(
      { ...ANTIGRAVITY_WS_AGENT, hydrated: pending },
      makeDeps(),
      fakeWs() as unknown as WebSocket,
      request(),
    );
    // A macrotask turn, not one microtask: every OTHER await on this path is an already-resolved
    // promise, so a handler that skipped the wait would be all the way through and spawned by now.
    // With a single `await Promise.resolve()` this test passes either way (measured).
    await new Promise((resolve) => setImmediate(resolve));
    expect(spawnAntigravityPty).not.toHaveBeenCalled();
    readable();
    await connection;
    expect(spawnAntigravityPty).toHaveBeenCalledTimes(1);
  });

  it("grok declares it has nothing to wait for, rather than leaving the question out", () => {
    expect(GROK_WS_AGENT.hydrated).toBeNull();
    expect(ANTIGRAVITY_WS_AGENT.hydrated).not.toBeNull();
  });
});

// muse's own half: the resume, and the one thing it does NOT share — where the groups end up.
describe("/ws/muse", () => {
  it("is handed the directory's groups like the other two, because its plugin is registered for the machine", () => {
    expect(MUSE_WS_AGENT.readsDirectoryMcpConfig).toBe(true);
    expect(ANTIGRAVITY_WS_AGENT.readsDirectoryMcpConfig).toBe(true);
    expect(GROK_WS_AGENT.readsDirectoryMcpConfig).toBe(true);
  });

  // The chat-history case: the row the picker offers IS one of muse's own ids, so the connection
  // has to resume it rather than start a fresh session under it.
  // A reconnect after a server restart has no live pty and often no `?cwd=` either, so the request
  // resolves to the DEFAULT workspace. muse records these groups as the session's entitlement, so
  // taking them from the request would make another directory's switches this session's
  // (Codex on #1514). The session's own directory is what the groups are read against.
  it("reads the groups against the session's own directory, not the reconnect's", async () => {
    const session = "11111111-2222-4333-8444-555555555555";
    const elsewhere = mkdtempSync(path.join(tmpdir(), "mt-elsewhere-"));
    sessionCwd.mockReturnValueOnce(elsewhere);
    museSessionExistsForCwd.mockResolvedValueOnce(true);
    try {
      await handleDirectoryMcpAgentConnection(MUSE_WS_AGENT, makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${session}`));
      expect(registeredGuiMcpGroups).toHaveBeenCalledWith(elsewhere, expect.anything());
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("resumes a session muse holds for this directory", async () => {
    const session = "11111111-2222-4333-8444-555555555555";
    museSessionExistsForCwd.mockResolvedValueOnce(true);
    await handleDirectoryMcpAgentConnection(MUSE_WS_AGENT, makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${session}`));
    expect(spawnMusePty).toHaveBeenCalledWith(session, expect.anything(), session, dir, { mcpGroups: ["render"] });
  });

  // A key that names nothing muse knows must not be handed to `muse resume` — and must not keep
  // the id either, or the client is stranded on a session that will never exist.
  it("starts fresh under a new id when the key names no session of muse's", async () => {
    const session = "11111111-2222-4333-8444-555555555555";
    await handleDirectoryMcpAgentConnection(MUSE_WS_AGENT, makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${session}`));
    expect(spawnMusePty).toHaveBeenCalledWith(expect.not.stringMatching(session), expect.anything(), null, dir, { mcpGroups: ["render"] });
  });
});
