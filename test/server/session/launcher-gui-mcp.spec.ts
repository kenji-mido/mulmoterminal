// @vitest-environment node
import { describe, it, expect } from "vitest";
import { launcherProgram, launcherCommandWithGuiMcp, launcherRunsAgent, launcherAgent } from "../../../server/session/launcher-gui-mcp.js";

// The "Codex" launcher chip and the Claude|Codex agent toggle land in the same grid cell and look
// the same, but the chip runs a COMMAND STRING through the login shell — there is no argv to add
// the GUI MCP to. The first "Canvas doesn't light up for codex" report was exactly this.
const SERVERS = [
  { id: "mulmoterminal-render", url: "http://127.0.0.1:34567/api/mcp/render/s1", autoApprove: true },
  { id: "mulmoterminal-media", url: "http://127.0.0.1:34567/api/mcp/media/s1", autoApprove: false },
];

const rewrite = (command: string, servers = SERVERS) => launcherCommandWithGuiMcp(command, servers, "darwin");

describe("launcherProgram", () => {
  it("ignores the path and a Windows extension", () => {
    expect(launcherProgram("codex")).toBe("codex");
    expect(launcherProgram("/opt/homebrew/bin/codex --model gpt-5")).toBe("codex");
    expect(launcherProgram("codex.cmd")).toBe("codex");
    expect(launcherProgram("  codex  ")).toBe("codex");
  });

  // An unrecognised shape means "leave it alone" — this rewrites the user's own command, so
  // guessing at env prefixes or quoting is the wrong direction.
  it("does not try to see through a wrapper", () => {
    expect(launcherProgram("FOO=1 codex")).not.toBe("codex");
    expect(launcherProgram("$SHELL")).toBe("$SHELL");
  });
});

// Codex, reviewing #1208: OR LAUNCH was the one route the one-session-per-worktree limit did not
// cover, so a launcher configured as `codex` started a second agent in an occupied worktree.
describe("launcherRunsAgent", () => {
  it.each([["codex"], ["claude"], ["antigravity"], ["/opt/homebrew/bin/codex --model gpt-5"], ["claude.cmd"]])("holds %s to the agent limit", (command) => {
    expect(launcherRunsAgent(command)).toBe(true);
  });

  // The other half of the rule: a worktree an agent is working in is exactly where someone wants a
  // dev server or a git UI, and refusing those would take away the point of having it open.
  it.each([["zsh"], ["/bin/bash -l"], ["yarn dev"], ["lazygit"], ["htop"], [""], ["   "]])("leaves %s alone", (command) => {
    expect(launcherRunsAgent(command)).toBe(false);
  });

  // Same recogniser as the MCP injection, so a command line reads as codex to both or to neither.
  it("does not see through a wrapper, and lets it run", () => {
    expect(launcherRunsAgent("FOO=1 codex")).toBe(false);
  });
});

describe("launcherCommandWithGuiMcp", () => {
  it("adds each server's url, and the approval only where it was granted", () => {
    expect(rewrite("codex")).toBe(
      `codex -c 'mcp_servers.mulmoterminal-render.url="http://127.0.0.1:34567/api/mcp/render/s1"' ` +
        `-c 'mcp_servers.mulmoterminal-render.default_tools_approval_mode="approve"' ` +
        `-c 'mcp_servers.mulmoterminal-media.url="http://127.0.0.1:34567/api/mcp/media/s1"'`,
    );
  });

  // codex's clap layout takes global options BEFORE the subcommand, so appending would break
  // `codex resume`. The user's own text after the program is put back byte for byte.
  it("inserts the flags after the program and keeps the rest verbatim", () => {
    const out = rewrite(`codex --model "gpt 5" resume`);
    expect(out.startsWith("codex -c ")).toBe(true);
    expect(out.endsWith(` --model "gpt 5" resume`)).toBe(true);
  });

  // The inner double quotes are codex's — `-c key="value"` is parsed as TOML and the value stops
  // being a string without them — so the whole thing has to survive as ONE shell word.
  it("wraps each override in a single shell word", () => {
    const words = rewrite("codex").match(/'[^']*'/g) ?? [];
    expect(words).toHaveLength(3);
    for (const word of words) expect(word).toContain('="');
  });

  // "Byte for byte" has to include the tail. A trailing backslash-newline continuation that gets
  // trimmed away leaves the shell reading an unterminated command.
  it("keeps trailing text the command line depends on", () => {
    const out = rewrite("codex --model gpt-5 \\\n  --search");
    expect(out.endsWith(" --model gpt-5 \\\n  --search")).toBe(true);
  });

  it("keeps the command's own leading whitespace", () => {
    expect(rewrite("  codex").startsWith("  codex -c ")).toBe(true);
  });

  it("leaves a command that is not codex alone", () => {
    expect(rewrite("$SHELL")).toBe("$SHELL");
    expect(rewrite("claude")).toBe("claude");
    expect(rewrite("FOO=1 codex")).toBe("FOO=1 codex");
  });

  // A directory that registered nothing must run the command the user configured, unchanged.
  it("leaves codex alone when the directory registered no groups", () => {
    expect(launcherCommandWithGuiMcp("codex", [], "darwin")).toBe("codex");
  });

  // Windows runs the command through powershell, which doubles a quote instead of escaping it.
  it("quotes for the platform it will run on", () => {
    const out = launcherCommandWithGuiMcp("codex", [SERVERS[0]], "win32");
    expect(out).toContain(`-c 'mcp_servers.mulmoterminal-render.url="http://127.0.0.1:34567/api/mcp/render/s1"'`);
  });
});

// The other half of the same question (Codex, on #1208): a launcher's agent was recorded as a
// plain shell, so the session it started was refused on the way IN but then invisible to the
// occupancy read — leaving the worktree free for a second agent as soon as the first detached.
describe("launcherAgent", () => {
  it("records the agent a launcher actually runs", () => {
    expect(launcherAgent("codex")).toBe("codex");
    expect(launcherAgent("/opt/homebrew/bin/claude --model opus")).toBe("claude");
    expect(launcherAgent("antigravity")).toBe("antigravity");
  });

  it("records everything else as a shell", () => {
    for (const command of ["zsh", "yarn dev", "lazygit", "FOO=1 codex", ""]) expect(launcherAgent(command)).toBe("shell");
  });

  // The pair has to agree: a command line that is held to the worktree limit must also be seen as
  // the worktree's occupant afterwards, or the limit protects a directory it cannot then measure.
  it("agrees with launcherRunsAgent on every command line", () => {
    for (const command of ["codex", "claude", "antigravity", "zsh", "yarn dev", "FOO=1 codex", "codex.cmd", ""]) {
      expect(launcherAgent(command) !== "shell", command).toBe(launcherRunsAgent(command));
    }
  });
});
