// Giving a LAUNCHER's codex the same GUI tools the agent toggle's codex gets.
//
// A launcher is a command string the user configured (`{label: "Codex", command: "codex"}`), run
// through the login shell — so unlike the first-class codex path there is no argv to add to, only
// text. The two look alike in the grid and land in the same cell, and a Canvas that lights up for
// one and never for the other reads as a broken feature; that is exactly how it was first
// reported.
//
// Only codex is touched, and only when it is the program being run. Everything else — a shell, a
// REPL, another agent — is passed through untouched: this rewrites a command the user wrote, so it
// has to be a narrow, recognisable case rather than a guess.
import path from "node:path";
import { shellQuoteFor } from "../config/header-resolve.js";
import { isTerminalAgent, type SessionAgent } from "../../common/sessionAgent.js";
import type { GuiMcpServer } from "../agents/codex-args.js";

// The program a command line runs, without its directory or a Windows extension: `codex`,
// `/opt/homebrew/bin/codex` and `codex.cmd` are the same program. A quoted or env-prefixed
// invocation (`FOO=1 codex`, `"my codex"`) is deliberately NOT unwrapped — an unrecognised shape
// means "leave it alone", which is the safe direction for rewriting someone's own command.
export function launcherProgram(command: string): string {
  const [first = ""] = command.trim().split(/\s+/, 1);
  return path.basename(first).replace(/\.(exe|cmd|bat)$/i, "");
}

/**
 * Whether a launcher's command line runs one of the agents, so the one-session-per-worktree limit
 * applies to it as it does to the agent toggle (#1207, raised by Codex on #1208: a launcher
 * configured as `codex` was a way around the limit the three agent endpoints enforce).
 *
 * Only the agents. A launcher is also how `yarn dev`, `lazygit` or `htop` is run, and refusing
 * THOSE in a worktree an agent is working in would take away the reason to have a worktree open at
 * all. Same recogniser as the MCP injection above, so a command line reads as codex to both or to
 * neither — and an unrecognised shape (`FOO=1 codex`, a wrapper script) is allowed, which is the
 * direction that never blocks someone from their own tools.
 */
export const launcherRunsAgent = (command: string): boolean => isTerminalAgent(launcherProgram(command));

/** What to RECORD for a launcher's session. The same answer as above, as the session kind — so a
 *  launcher's codex is the worktree's occupant afterwards, not only refused on the way in. */
export function launcherAgent(command: string): SessionAgent {
  const program = launcherProgram(command);
  return isTerminalAgent(program) ? program : "shell";
}

/**
 * Whether a chip's command line will actually be HANDED the GUI MCP — that is, whether one of the
 * two rewriters below will fire on it.
 *
 * Not `launcherRunsAgent`: that also answers yes for antigravity, which has no rewriter here. The
 * difference matters to anything that records a consequence of the injection rather than performing
 * it — a chip running `zsh`, `yarn dev` or `agy` is handed no MCP at all, and marking it as carrying
 * every GUI tool misreports it to `/api/tools` (Codex review on #1399). The same mistake the config
 * FILE made before #1358, made again for the record instead of the file.
 *
 * A spec pins this against what the rewriters actually do, so the two cannot drift apart.
 */
export const launcherTakesGuiMcp = (command: string): boolean => {
  const program = launcherProgram(command);
  return program === "claude" || program === "codex";
};

/**
 * A launcher chip that runs CLAUDE, which reaches the GUI MCP through flags
 * rather than `-c` overrides: `--mcp-config <path> --allowedTools <list>`, the same two a claude
 * cell in the workspace is spawned with.
 *
 * It used to pass `--strict-mcp-config` as well, for parity with the cell — and that was right
 * about parity and wrong about the flag: both were hiding the user's claude.ai connectors and
 * their own MCP servers (#1338, #1385). Parity is still the goal, so this drops the flag on the
 * same commit the cell does. What keeps the chip from seeing a tool twice is not the flag; it is
 * that the group urls stand down for a session holding the all-tools url (mcp/tool-gate.ts).
 *
 * The config is a PATH, never inline JSON — see mcpConfigFileArgument.
 *
 * Only the workspace asks for this, and the caller decides that: a chip in a project directory is
 * passed nothing, exactly as a project cell is, and its claude reads the directory's own config.
 */
export function launcherCommandWithClaudeGuiMcp(
  command: string,
  gui: { mcpConfigPath: string; allowedTools: string } | null,
  platform: NodeJS.Platform,
): string {
  if (gui === null || launcherProgram(command) !== "claude") return command;
  const quote = shellQuoteFor(platform);
  const flags = ["--mcp-config", quote(gui.mcpConfigPath)];
  if (gui.allowedTools) flags.push("--allowedTools", quote(gui.allowedTools));
  return insertAfterProgram(command, flags);
}

/** The command to actually run, with codex's MCP overrides inserted when this launcher runs codex. */
export function launcherCommandWithGuiMcp(command: string, servers: readonly GuiMcpServer[], platform: NodeJS.Platform): string {
  if (servers.length === 0 || launcherProgram(command) !== "codex") return command;
  const quote = shellQuoteFor(platform);
  const flags = servers.flatMap((server) => {
    // Quoted as ONE shell word each, because this is text handed to a shell rather than an argv
    // element. The inner double quotes are codex's, not the shell's — `-c key="value"` is parsed
    // as TOML and the value stops being a string without them.
    const parts = [`-c`, quote(`mcp_servers.${server.id}.url="${server.url}"`)];
    if (server.autoApprove) parts.push(`-c`, quote(`mcp_servers.${server.id}.default_tools_approval_mode="approve"`));
    return parts;
  });
  return insertAfterProgram(command, flags);
}

// Put `flags` directly after the program, leaving everything else byte for byte.
//
// Scanned rather than split-and-rejoined: everything around the program is the user's text —
// quoting, spacing, and a trailing backslash-newline continuation included. Trimming the tail
// would turn such a continuation into an unterminated command.
//
// Two index walks rather than one anchored regex: `^(\s*)(\S+)([\s\S]*)$` backtracks
// super-linearly on a long command (sonarjs flags it), and this says the same thing.
//
// Directly after the program rather than appended, because BOTH agents need it there: codex's clap
// layout takes global options before the subcommand (`codex resume`), and claude's own trailing
// `--add-dir` is variadic, so a flag after it would be swallowed as one more directory.
function insertAfterProgram(command: string, flags: readonly string[]): string {
  const isSpace = (index: number): boolean => /\s/.test(command[index] ?? "");
  let start = 0;
  while (start < command.length && isSpace(start)) start++;
  if (start === command.length) return command; // whitespace only — nothing to run
  let end = start;
  while (end < command.length && !isSpace(end)) end++;
  return `${command.slice(0, end)} ${flags.join(" ")}${command.slice(end)}`;
}
