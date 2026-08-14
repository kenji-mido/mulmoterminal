// Pure builder for the `claude` CLI argv. Kept separate so the exact flag set —
// especially the GUI-MCP switch — is unit-testable without spawning a PTY.
//
// It passes NO `--strict-mcp-config`. The flag was welded to `--mcp-config` here, which is how
// attaching the GUI panel came to also hide the user's claude.ai connectors, `~/.claude.json`,
// their plugin servers and the directory's own `.mcp.json` (#1338, #1385). Deleted rather than
// made a parameter: no caller would set it, and a one-valued flag is the weld waiting to be
// re-made. `rate-limit-probe.ts` still passes it, for a different and measured reason.

import type { AppendedPromptArgument } from "../session/session-settings.js";

export interface ClaudeArgsInput {
  sessionId: string;
  resume: string | null;
  // Whether the requested session has an on-disk transcript to --resume. When
  // false we start fresh, reusing the id via --session-id.
  canResume: boolean;
  settings: string; // hook settings JSON (--settings)
  permissionMode: string; // --permission-mode
  // true  (single view, workspace cell): attach the in-process GUI MCP on one url carrying every
  //        tool, and auto-allow its tools.
  // false (project-directory cell): no GUI MCP of ours — the directory's own config is where its
  //        GUI tool groups come from (see common/toolGroups.ts).
  // Either way the user's + project's MCP servers load: the difference is what WE add, not what
  // they lose.
  attachGuiMcp: boolean;
  mcpConfig: string; // GUI MCP config JSON (--mcp-config), used only when attachGuiMcp
  // Comma-joined fully-qualified tool names for --allowedTools. Passed in BOTH modes: a grid
  // cell gets no --mcp-config, but still needs its render-group tools pre-approved so they
  // don't stop at a permission prompt on every call. Verified that --allowedTools alone
  // pre-approves without restricting anything else — it is an additive allowlist, not "only
  // these".
  allowedTools: string;
  // What this session runs (#579): an alias (sonnet/opus/haiku) or a backend's own model
  // name. Null leaves the choice to Claude Code. `--model` outranks both the settings
  // `model` key and ANTHROPIC_MODEL, so it is the one place the decision has to be made.
  model?: string | null;
  // Extra directories the session may read/edit (#908). Absolute, existing, deduped by the
  // config layer — this builder only places them.
  addDirs?: string[] | null | undefined;
  // What `--append-system-prompt` carries, already assembled (see appended-prompt.ts) AND already
  // placed — inline, or in a file whose path this passes instead (see appendedPromptArgument).
  // Null when every section of it is switched off, and the flag is then left out entirely.
  // Resolved by the caller: which sections apply is a config decision, where the text may travel
  // is a platform one, and this builder only places argv.
  //
  // Required, unlike the other optional fields: they default to adding nothing, while forgetting
  // this one would silently drop an instruction every session used to carry. A new spawn path has
  // to answer for it, and `null` is how it says no. `undefined` is in the type but the KEY is
  // still mandatory — a value that was never resolved can arrive, but a caller cannot omit it.
  appendedPrompt: AppendedPromptArgument | null | undefined;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const guiArgs = ["--permission-mode", input.permissionMode];
  // Two flags for one setting, because Claude Code names the file form separately. Which one is
  // not this builder's call — a Windows command line cannot carry the newlines this text has, so
  // there the caller writes a file and sends its path (#1516, session-settings.ts).
  //
  // The inline form was once the only one, on the grounds that the Docker sandbox could not read
  // a host path. That sandbox is gone (#1195), so the file form costs nothing anywhere.
  if (input.appendedPrompt) {
    const { kind } = input.appendedPrompt;
    guiArgs.push(
      kind === "file" ? "--append-system-prompt-file" : "--append-system-prompt",
      kind === "file" ? input.appendedPrompt.path : input.appendedPrompt.text,
    );
  }
  if (input.model) guiArgs.push("--model", input.model);
  // --mcp-config ADDS our broker; it does not replace anything. `--strict-mcp-config` used to
  // ride along on this same line, and that is what made "give this session the GUI panel" also
  // mean "cut it off from the user's own MCP" (#1338, #1385).
  if (input.attachGuiMcp) {
    guiArgs.push("--mcp-config", input.mcpConfig);
  }
  // Outside the block: a grid cell gets no --mcp-config but still wants its render-group tools
  // auto-allowed, and those reach it through the user's own MCP config. Empty means nothing to
  // pre-approve.
  if (input.allowedTools) guiArgs.push("--allowedTools", input.allowedTools);
  // LAST, and one flag for the whole list: `--add-dir` is variadic (`<directories...>`), so a
  // flag placed after it would be fine but a VALUE would be swallowed. Keeping it at the end
  // means nothing can ever follow it.
  if (input.addDirs?.length) guiArgs.push("--add-dir", ...input.addDirs);

  // No initial-prompt positional: an auto-run prompt is TYPED into the input box after
  // claude is ready (see spawnClaudePty), not passed as an arg — a large prompt as a
  // tmux `new-session` command arg overflows tmux's length limit ("command too long").
  return input.canResume && input.resume !== null
    ? ["--resume", input.resume, "--settings", input.settings, ...guiArgs]
    : ["--session-id", input.sessionId, "--settings", input.settings, ...guiArgs];
}
