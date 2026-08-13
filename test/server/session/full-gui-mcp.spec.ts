// @vitest-environment node
// Which sessions carry the whole GUI MCP, and — the point of the file — which do NOT.
//
// PR2 gives a grid cell running in the workspace the surface the single view has always had, and
// the follow-up extends that to every way of starting a terminal there — a codex cell, and a
// launcher chip running either agent. The constraint all of it is written under is that anything in
// a PROJECT directory keeps the behaviour it has today, exactly. That is an invariant, and an
// invariant nothing asserts is just a hope: this is the assertion.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "mt-fullgui-"));
const WORKSPACE = path.join(ROOT, "workspace");
const PROJECT = path.join(ROOT, "project");
mkdirSync(WORKSPACE, { recursive: true });
mkdirSync(PROJECT, { recursive: true });
const REAL_CLAUDE_CWD = process.env.CLAUDE_CWD;
process.env.CLAUDE_CWD = WORKSPACE;

const { carriesFullGuiMcp } = await import("../../../server/session/mcp-config.js");
const { buildClaudeArgs } = await import("../../../server/agents/claude-args.js");
const { launcherCommandWithClaudeGuiMcp, launcherCommandWithGuiMcp, launcherTakesGuiMcp } = await import("../../../server/session/launcher-gui-mcp.js");

afterAll(() => {
  if (REAL_CLAUDE_CWD === undefined) delete process.env.CLAUDE_CWD;
  else process.env.CLAUDE_CWD = REAL_CLAUDE_CWD;
  rmSync(ROOT, { recursive: true, force: true });
});

// `attachGuiMcp` is what the WIRE says: false for a grid cell (?gui=0), true for everything else.
const GRID_CELL = false;
const NOT_A_GRID_CELL = true;

describe("carriesFullGuiMcp", () => {
  it("does NOT give it to a grid cell in a project directory", () => {
    // The invariant. If this ever flips, every ordinary cell in the grid silently changes what
    // tools it has and where they come from.
    expect(carriesFullGuiMcp(GRID_CELL, PROJECT)).toBe(false);
  });

  it("gives it to a grid cell running in the workspace", () => {
    expect(carriesFullGuiMcp(GRID_CELL, WORKSPACE)).toBe(true);
  });

  it("gives it to a grid cell that named no directory — that IS the workspace", () => {
    expect(carriesFullGuiMcp(GRID_CELL, undefined)).toBe(true);
  });

  // A LAUNCHER chip has no wire flag — it is never the single view — so the cwd is the only thing
  // that can earn it, which is what the route passes `false` for. Same predicate, so a chip and the
  // cell beside it agree about which directory is special.
  it("answers for a launcher chip on the cwd alone", () => {
    expect(carriesFullGuiMcp(false, WORKSPACE)).toBe(true);
    expect(carriesFullGuiMcp(false, PROJECT)).toBe(false);
  });

  it("still gives it to everything that is not a grid cell, whatever the directory", () => {
    // The single view, and every chat spawned without a cell of its own (spawnBackgroundChat,
    // the translation worker, issue work). Unchanged: the wire flag alone decides these.
    expect(carriesFullGuiMcp(NOT_A_GRID_CELL, PROJECT)).toBe(true);
    expect(carriesFullGuiMcp(NOT_A_GRID_CELL, WORKSPACE)).toBe(true);
  });

  it("does NOT give it to a cell in a subdirectory of the workspace", () => {
    // Equality, not prefix — `{workspace}/foo` is an ordinary project.
    expect(carriesFullGuiMcp(GRID_CELL, path.join(WORKSPACE, "foo"))).toBe(false);
  });
});

// The other half: that the flag reaches the argv in the two shapes it is supposed to. Pinned
// against buildClaudeArgs rather than a spawn, so it needs no PTY.
describe("the argv each kind of session gets", () => {
  const args = (attachGuiMcp: boolean) =>
    buildClaudeArgs({
      model: null,
      sessionId: "s",
      resume: null,
      canResume: false,
      settings: "{}",
      permissionMode: "default",
      attachGuiMcp,
      mcpConfig: "MCP_CONFIG",
      allowedTools: attachGuiMcp ? "GUI_TOOLS" : "GRID_TOOLS",
      addDirs: [],
      appendedPrompt: null,
    });

  it("carries --mcp-config when it has the full GUI MCP, and nothing that isolates", () => {
    const argv = args(true);
    expect(argv).toContain("--mcp-config");
    expect(argv[argv.indexOf("--mcp-config") + 1]).toBe("MCP_CONFIG");
    expect(argv).toContain("GUI_TOOLS");
    // #1338 / #1385: our broker is ADDED to what the session reaches. Isolating to it took the
    // user's claude.ai connectors and their own MCP servers away with the directory's .mcp.json.
    expect(argv).not.toContain("--strict-mcp-config");
  });

  it("carries no --mcp-config for a project-directory cell, so its own MCP config supplies the tools", () => {
    // Withholding ours is how a grid cell keeps reaching the servers its directory registered —
    // the mechanism the Canvas depends on there.
    const argv = args(false);
    expect(argv).not.toContain("--mcp-config");
    expect(argv).not.toContain("--strict-mcp-config");
    expect(argv).toContain("GRID_TOOLS");
  });
});

// The third shape: a launcher CHIP, where the same flags have to be inserted into a command line
// rather than appended to an argv. A chip running plain `claude` in the workspace had no Canvas at
// all while the cell beside it had every tool — that gap is what this closes.
describe("the command line a launcher chip ends up with", () => {
  const GUI = { mcpConfigPath: "/home/u/.mulmoterminal/settings/s-mcp.json", allowedTools: "mcp__mt__presentChart" };
  const rewrite = (command: string, gui: typeof GUI | null = GUI) => launcherCommandWithClaudeGuiMcp(command, gui, "darwin");

  it("gives a claude chip the same flags a claude cell is spawned with", () => {
    expect(rewrite("claude")).toBe(`claude --mcp-config '/home/u/.mulmoterminal/settings/s-mcp.json' --allowedTools 'mcp__mt__presentChart'`);
  });

  // The chip drops --strict-mcp-config on the same commit the cell does. Parity is the reason it
  // carried the flag at all, so parity is the reason it stops (#1338).
  it("does not isolate the chip's claude from the user's own MCP either", () => {
    expect(rewrite("claude")).not.toContain("--strict-mcp-config");
  });

  // Directly after the program, never appended: claude's own trailing `--add-dir` is variadic, so
  // a flag placed after it would be swallowed as one more directory.
  it("inserts after the program and puts the user's own text back byte for byte", () => {
    expect(rewrite("claude --model opus  --resume x")).toContain("claude --mcp-config");
    expect(rewrite("claude --model opus  --resume x")).toMatch(/--allowedTools '\S+' --model opus {2}--resume x$/);
  });

  // null is how a PROJECT-directory chip arrives — the route passes nothing there, so its claude
  // reads the directory's own MCP config exactly as it did before.
  it("leaves the command alone when there is no GUI MCP to give", () => {
    expect(rewrite("claude", null)).toBe("claude");
  });

  // The same recogniser the codex rewriter uses, and the same refusal to see through a wrapper:
  // this edits text the user wrote, so an unrecognised shape means leave it alone.
  it.each([["codex"], ["zsh"], ["yarn dev"], ["FOO=1 claude"], [""], ["   "]])("leaves %s alone", (command) => {
    expect(rewrite(command)).toBe(command);
  });
});

// `launcherTakesGuiMcp` answers a question the two rewriters below answer by ACTING, and anything
// that records a consequence of the injection has to agree with them — a chip marked as carrying
// every GUI tool while being handed none misreports itself to /api/tools (Codex on #1399). So the
// predicate is pinned against what the rewriters actually do, rather than restated.
describe("which chips are handed the GUI MCP at all", () => {
  const CLAUDE_GUI = { mcpConfigPath: "/home/u/.mulmoterminal/settings/s-mcp.json", allowedTools: "mcp__mt__presentChart" };
  const CODEX_GUI = [{ id: "mt", url: "http://127.0.0.1:1/api/mcp/s", autoApprove: true }];
  // Either rewriter firing means the command line came back changed; both see every command and
  // each recognises only its own program, so at most one can fire.
  const rewritten = (command: string) =>
    launcherCommandWithClaudeGuiMcp(command, CLAUDE_GUI, "darwin") !== command || launcherCommandWithGuiMcp(command, CODEX_GUI, "darwin") !== command;

  it.each([
    ["claude"],
    ["codex"],
    ["claude --model opus"],
    ["codex resume"],
    ["zsh"],
    ["yarn dev"],
    ["agy"],
    ["antigravity"],
    ["lazygit"],
    ["FOO=1 claude"],
    [""],
    ["   "],
  ])("agrees with the rewriters on %j", (command) => {
    expect(launcherTakesGuiMcp(command)).toBe(rewritten(command));
  });

  // The one this exists for. `launcherRunsAgent` says yes here (antigravity IS an agent), and using
  // that as the gate is what over-marked the session.
  it("says no to an agent with no rewriter", () => {
    expect(launcherTakesGuiMcp("antigravity")).toBe(false);
  });
});
