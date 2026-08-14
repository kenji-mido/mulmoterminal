// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// node-pty is a native module and spawning is the whole point of the file under test, so
// the pty itself is mocked: what matters here is the ENVIRONMENT handed to it.
const spawn = vi.fn(() => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn() }));
vi.mock("node-pty", () => ({ default: { spawn: (...args: unknown[]) => spawn(...(args as [])) } }));
const scrub = vi.fn();
vi.mock("../../../server/infra/tmux.js", () => ({
  tmuxAvailable: () => tmuxOn,
  tmuxHasSession: (id: string) => liveTmuxSessions.has(id),
  // The real one turns `env` into `-e KEY=VALUE` pairs, which is the only way a variable
  // reaches a tmux PANE — so the fake has to carry it or the #1367 assertions below prove nothing.
  tmuxNewSessionArgs: (id: string, file: string, args: string[], _cwd: string, env: Record<string, string> = {}) => [
    "new-session",
    id,
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    file,
    ...args,
  ],
  tmuxScrubEnvNames: (names: readonly string[]) => scrub(names),
}));

// What this directory holds per working tree (#1367). Mocked rather than reserved for real:
// what is under test is that a spawn CARRIES it, not how it was decided.
vi.mock("../../../server/config/worktree-env.js", () => ({ reservedWorktreeEnv: () => reserved }));

let tmuxOn = false;
let reserved: Record<string, string> = {};
const liveTmuxSessions = new Set<string>();

// ptySpawn stats the cwd and refuses a spawn into a directory that is not there, so this cannot
// be a literal: "/tmp" is not a directory on Windows, which failed only in the Windows job. Our
// own cwd is a directory on every platform, by definition — the same reasoning diagnoseSpawnCwd
// applies to an empty cwd.
const EXISTING_CWD = process.cwd();

// Real-shaped ids: ptySpawn now refuses anything SESSION_ID_RE rejects (#1533), so S1 is no
// longer a session id a spawn will accept.
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const S2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const { spawnPty, ptySpawn, ptyWouldReattach } = await import("../../../server/session/pty-spawn.js");

const envOf = (call: number = 0): NodeJS.ProcessEnv => (spawn.mock.calls[call] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env;

beforeEach(() => {
  spawn.mockClear();
  scrub.mockClear();
  tmuxOn = false;
  reserved = {};
  liveTmuxSessions.clear();
  process.env.ANTHROPIC_API_KEY = "sk-ant-leftover";
  process.env.MT_KEEP_ME = "kept";
});

// A leftover ANTHROPIC_API_KEY silently outranks the auth token that aims a provider
// session at its backend, and the settings `env` block can set a variable but not remove
// one. So the removal has to happen HERE — computing it and not applying it (which is
// exactly what shipped first) leaves the routing broken with no symptom until a request.
describe("spawnPty — the environment it hands the pty", () => {
  it("removes the named variables", () => {
    spawnPty("claude", [], EXISTING_CWD, ["ANTHROPIC_API_KEY"]);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("keeps everything else", () => {
    spawnPty("claude", [], EXISTING_CWD, ["ANTHROPIC_API_KEY"]);
    expect(envOf().MT_KEEP_ME).toBe("kept");
  });

  it("leaves the environment alone when nothing is named", () => {
    spawnPty("claude", [], EXISTING_CWD);
    expect(envOf().ANTHROPIC_API_KEY).toBe("sk-ant-leftover");
  });
});

// `new-session -A` returns a terminal whether it created one or picked up a survivor, so a
// caller that must not treat the second as a fresh start has to ask beforehand. What hangs on
// it: a reattached claude never re-reads the user's MCP config, so resetting its learned tool
// groups there would drop them with nothing left to relearn from.
describe("ptyWouldReattach", () => {
  it("is true only when tmux is holding this exact session", () => {
    tmuxOn = true;
    liveTmuxSessions.add(S1);
    expect(ptyWouldReattach(S1, true)).toBe(true);
    expect(ptyWouldReattach(S2, true)).toBe(false);
  });

  it("is false without tmux — every spawn there starts a new process", () => {
    tmuxOn = false;
    liveTmuxSessions.add(S1);
    expect(ptyWouldReattach(S1, true)).toBe(false);
  });

  // Matches ptySpawn's own branch: a non-persistent spawn never consults tmux at all.
  it("is false for a non-persistent spawn", () => {
    tmuxOn = true;
    liveTmuxSessions.add(S1);
    expect(ptyWouldReattach(S1, false)).toBe(false);
  });
});

// The tmux pane inherits the tmux SERVER's environment rather than this one, so the scrub
// there is what actually protects it — but the non-tmux path has only this.
describe("ptySpawn — carries the removal down both paths", () => {
  it("applies it on the direct spawn", () => {
    ptySpawn(S1, "claude", [], EXISTING_CWD, false, { unset: ["ANTHROPIC_API_KEY"] });
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("applies it on the tmux spawn too", () => {
    tmuxOn = true;
    const result = ptySpawn(S1, "claude", [], EXISTING_CWD, true, { unset: ["ANTHROPIC_API_KEY"] });
    expect(result.tmux).toBe(true);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});

// Stripping our own copy is not enough: a pane inherits the tmux SERVER's environment,
// and a server created by an earlier non-provider session already carries the key. The
// scrub in ensureConf only covers a server that predates this process.
describe("ptySpawn — the tmux server's own environment", () => {
  it("scrubs the names from the running server before a provider spawn", () => {
    tmuxOn = true;
    ptySpawn(S1, "claude", [], EXISTING_CWD, true, { unset: ["ANTHROPIC_API_KEY"] });
    expect(scrub).toHaveBeenCalledWith(["ANTHROPIC_API_KEY"]);
  });

  it("leaves the server alone for an ordinary session", () => {
    tmuxOn = true;
    ptySpawn(S1, "claude", [], EXISTING_CWD, true);
    expect(scrub).not.toHaveBeenCalled();
  });
});

// A worktree isolates files, not ports (#1367). The values are reserved before the spawn; what
// this pins is that every terminal actually RUNS with them — including the tmux path, where the
// pane's environment comes from `new-session -e` and not from the process spawned here.
describe("the per-tree environment a directory reserved", () => {
  const argsOf = (call: number = 0): string[] => (spawn.mock.calls[call] as unknown as [string, string[]])[1];

  it("reaches a plain spawn", () => {
    reserved = { PORT: "3010", DB_NAME: "myapp_fix_login" };
    spawnPty("yarn", ["dev"], EXISTING_CWD);
    expect(envOf().PORT).toBe("3010");
    expect(envOf().DB_NAME).toBe("myapp_fix_login");
  });

  it("reaches a direct ptySpawn", () => {
    reserved = { PORT: "3010" };
    ptySpawn(S1, "claude", [], EXISTING_CWD, false);
    expect(envOf().PORT).toBe("3010");
  });

  it("is handed to the tmux pane through -e", () => {
    reserved = { PORT: "3010" };
    tmuxOn = true;
    ptySpawn(S1, "claude", [], EXISTING_CWD, true);
    expect(argsOf()).toContain("PORT=3010");
  });

  // The spawner's own values are about THIS session and could not have been reserved for a
  // directory; a project declaring the same name must not be able to redirect our MCP bridge.
  it("loses to a value the spawner computed for this session", () => {
    reserved = { MULMOTERMINAL_SESSION: "from-config", PORT: "3010" };
    ptySpawn(S1, "claude", [], EXISTING_CWD, false, { env: { MULMOTERMINAL_SESSION: S1 } });
    expect(envOf().MULMOTERMINAL_SESSION).toBe(S1);
    expect(envOf().PORT).toBe("3010");
  });

  it("sets nothing when the directory reserved nothing", () => {
    spawnPty("claude", [], EXISTING_CWD);
    expect(envOf()).not.toHaveProperty("PORT");
  });
});

// A live `mt-undefined` was found running muse (#1533): a spawn reached tmux with an id that was
// never set, and every later spawn with the same defect would have attached that same pane. The
// guard makes that a failed launch with a message instead of a silently shared terminal.
describe("ptySpawn — the session-id guard", () => {
  it("refuses an id that is not a session id, before anything is spawned", () => {
    expect(() => ptySpawn("undefined", "claude", [], EXISTING_CWD, true)).toThrow(/invalid session id/);
    expect(spawn).not.toHaveBeenCalled();
  });

  // The one non-random id shape in the codebase — it must keep passing, or every rate-limit
  // probe dies at launch.
  it("accepts a probe id, which is UUID-shaped by construction", async () => {
    const { newProbeSessionId } = await import("../../../server/agents/probe-session.js");
    ptySpawn(newProbeSessionId(), "claude", [], EXISTING_CWD, false);
    expect(spawn).toHaveBeenCalled();
  });
});
