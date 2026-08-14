// @vitest-environment node
// The #1536 fixes on the connect path, asserted through the real handlers.
//
// After a server restart `ptys` is empty while tmux still holds `mt-<session>` — the state every
// `!live` test misreads as a fresh spawn. The codex handler read the directory's tool groups on
// that path from the REQUEST cwd, which a restart reconnect often leaves at the default
// workspace — another directory's switches, exactly the wrong-cwd read #1514 fixed on the
// directory-MCP handler. And claude was the one agent endpoint that never asked
// clientStillConnected after its admission awaits, so a client that left mid-admission still got
// a pty — spawned after the socket's close event, which no later close handler can reap.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
  // Whether tmux still holds the requested session — the restart-survivor case.
  tmuxHas: false,
  // What the dev-terminal cwd log remembers for the session, or null for one it never saw.
  rememberedCwd: null as string | null,
  // The session ids with a claude transcript on disk — the #1537 guard's claude evidence.
  claudeOnDisk: [] as string[],
  // Whether grok holds a conversation under the requested key, in any cwd partition.
  grokHas: false,
  // Lets a test simulate the client leaving inside an admission await.
  onEnsureWorktreeEnv: () => {},
}));

const ptys = new Map<string, unknown>();
const codexRollouts = new Map<string, unknown>();
vi.mock("../../../server/session/registry.js", () => ({
  ptys,
  sessionCwd: () => mocks.rememberedCwd,
  devTerminalCwdsHydrated: Promise.resolve(),
  antigravityConversations: new Map(),
  antigravityConversationsHydrated: Promise.resolve(),
  museConversations: new Map(),
  museConversationsHydrated: Promise.resolve(),
  codexRollouts,
  codexRolloutsHydrated: Promise.resolve(),
  customAgentSessionsHydrated: Promise.resolve(),
  markDevTerminalSession: vi.fn(),
  markAttachedSessionPlaced: vi.fn(),
}));

// The #1537 guard's other evidence probes walk the developer's real home directories; each is
// pinned so a survivor's identity in these tests comes only from what a test declares.
vi.mock("../../../server/session/session-reads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/session-reads.js")>()),
  claudeOnDiskSessionIds: () => new Set(mocks.claudeOnDisk),
}));
vi.mock("../../../server/agents/antigravity-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/antigravity-session.js")>()),
  antigravityConversationExists: () => false,
}));
vi.mock("../../../server/agents/grok-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/grok-session.js")>()),
  grokConversationExistsInAnyCwd: () => mocks.grokHas,
}));

// The guard shares one evidence snapshot per reconnect burst (EVIDENCE_SNAPSHOT_MS). Each test
// here is its own burst, so the clock steps past the window in beforeEach — otherwise one
// test's snapshot (its claude transcript set, baked at walk time) answers for the next.
let nowMs = 0;
vi.spyOn(Date, "now").mockImplementation(() => nowMs);

vi.mock("../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/tmux.js")>()),
  tmuxAvailable: () => true,
  tmuxHasSession: () => mocks.tmuxHas,
}));

// The rollout probe walks codex's real sessions root on disk; the resolver must not.
vi.mock("../../../server/agents/codex-sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/codex-sessions.js")>()),
  codexRolloutExists: () => false,
}));

const registeredGuiMcpGroups = vi.fn(() => Promise.resolve(["render"]));
vi.mock("../../../server/infra/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups }));

vi.mock("../../../server/config/worktree-env.js", () => ({
  ensureWorktreeEnv: vi.fn(() => {
    mocks.onEnsureWorktreeEnv();
    return Promise.resolve({});
  }),
  reservedWorktreeEnv: () => ({}),
}));

// A real occupancy read runs git against the cwd; this spec is about the handlers' shape.
vi.mock("../../../server/session/worktree-session-limit.js", () => ({
  claimLaunch: () => ({ release: vi.fn(), contended: false }),
  worktreeOccupancy: () => Promise.resolve({ isWorktree: false, session: null }),
}));

const { handleClaudeConnection, handleCodexConnection } = await import("../../../server/routes/ws-routes.js");

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02";
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

const spawnClaudePty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const spawnCodexPty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const makeDeps = () =>
  ({
    spawnClaudePty,
    spawnCodexPty,
    reattachPty: vi.fn(),
    setWaiting: vi.fn(),
    handleClientFrame: vi.fn(),
    handleClientClose: vi.fn(),
  }) as never;

let dir = "";
const request = (query = "") => ({ url: `/ws?cwd=${encodeURIComponent(dir)}${query}` });

beforeEach(() => {
  ptys.clear();
  codexRollouts.clear();
  vi.clearAllMocks();
  mocks.tmuxHas = false;
  mocks.rememberedCwd = null;
  mocks.claudeOnDisk = [];
  mocks.grokHas = false;
  mocks.onEnsureWorktreeEnv = () => {};
  nowMs += 60_000;
  registeredGuiMcpGroups.mockResolvedValue(["render"]);
  dir = mkdtempSync(path.join(tmpdir(), "mt-ws-restart-"));
});
afterEach(() => {
  ptys.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe("/ws/codex after a server restart (tmux survivor, no live pty)", () => {
  // A restart reconnect often carries no ?cwd= at all, which resolves to the DEFAULT workspace —
  // so the groups must come from where the session really runs (the remembered cwd, #1514's
  // shape). Still read rather than skipped: if tmux dies between this handler and the spawn, the
  // fresh codex that ptySpawn's fallback starts must not come up with no GUI tools at all.
  it("keeps the id, passes no resume id, and reads the groups from the session's own cwd", async () => {
    mocks.tmuxHas = true;
    mocks.rememberedCwd = "/where-it-really-runs";
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(registeredGuiMcpGroups).toHaveBeenCalledWith("/where-it-really-runs", expect.anything());
    expect(spawnCodexPty).toHaveBeenCalledWith(SID, expect.anything(), null, dir, false, { mcpGroups: ["render"] });
  });

  it("reads the directory's groups from the request cwd for a genuinely fresh grid cell", async () => {
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request("&gui=0"));
    expect(registeredGuiMcpGroups).toHaveBeenCalledWith(dir, expect.anything());
    expect(spawnCodexPty).toHaveBeenCalledWith(expect.any(String), expect.anything(), null, dir, false, { mcpGroups: ["render"] });
  });
});

describe("/ws (claude) admission", () => {
  it("spawns nothing for a client that left during the admission awaits", async () => {
    const ws = fakeWs();
    mocks.onEnsureWorktreeEnv = () => {
      ws.readyState = 3; // the client closes while the handler awaits the worktree env
    };
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request());
    expect(spawnClaudePty).not.toHaveBeenCalled();
  });

  it("spawns for a client that stayed", async () => {
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request());
    expect(spawnClaudePty).toHaveBeenCalledTimes(1);
  });
});

// The #1537 guard, through the real handlers: a tmux-only survivor has no PtyEntry for
// wrongEndpointReason to compare, and `tmux new-session -A` attaches whatever runs in the pane
// while ignoring the argv — so a stale persisted cell could relabel a codex survivor as claude.
describe("tmux survivor identity (#1537)", () => {
  const codexEvidence = () => codexRollouts.set(SID, { sessionId: SID, conversationId: "c1", cwd: "/w", startedAt: 1 });

  it("refuses, loudly, a claude reconnect to a survivor codex's evidence claims", async () => {
    mocks.tmuxHas = true;
    codexEvidence();
    const ws = fakeWs();
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).not.toHaveBeenCalled();
    // An error frame, not a plain close: a plain close makes the client retry the same
    // mismatched id forever, and the defect is persisted state the user has to act on.
    expect(ws.sent.some((frame) => frame.includes("belongs to codex, not claude"))).toBe(true);
  });

  it("refuses the reverse — a codex reconnect to a survivor with a claude transcript", async () => {
    mocks.tmuxHas = true;
    mocks.claudeOnDisk = [SID];
    const ws = fakeWs();
    await handleCodexConnection(makeDeps(), ws as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(spawnCodexPty).not.toHaveBeenCalled();
    expect(ws.sent.some((frame) => frame.includes("belongs to claude, not codex"))).toBe(true);
  });

  it("refuses a claude reconnect to a survivor grok's evidence claims", async () => {
    mocks.tmuxHas = true;
    mocks.grokHas = true;
    const ws = fakeWs();
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).not.toHaveBeenCalled();
    expect(ws.sent.some((frame) => frame.includes("belongs to grok, not claude"))).toBe(true);
  });

  it("serves a survivor to its own endpoint, evidence agreeing", async () => {
    mocks.tmuxHas = true;
    codexEvidence();
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(spawnCodexPty).toHaveBeenCalledTimes(1);
  });

  // Refuse-on-proof only: a shell/launcher survivor (or an agent that never reached its first
  // turn) leaves no evidence, and locking users out of a legitimately surviving session would
  // be worse than the mislabel this guard prevents.
  it("attaches an evidence-less survivor as requested", async () => {
    mocks.tmuxHas = true;
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).toHaveBeenCalledTimes(1);
  });
});
