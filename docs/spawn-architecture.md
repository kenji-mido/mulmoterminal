# How a `claude` session is spawned

Every MulmoTerminal session is a **real, interactive `claude` running in a PTY**
(`node-pty`), streamed to the browser over a WebSocket. It is **not** a headless
agent — it's the normal Claude Code TUI. MulmoTerminal only injects a few flags to
wire the session into the sidebar, the GUI panel, and permission handling.

This document lists every spawn setting, what it's for, and the risk of changing
it — and the open decision around MCP scoping.

## The spawn call

`server/index.ts` → `spawnClaudePty()`:

```ts
pty.spawn(CLAUDE_BIN, [
  // session identity (one of):
  "--session-id", "<uuid>",        // new session (server-chosen id)
  "--resume",     "<uuid>",        // resume an existing session
  // wiring:
  "--settings",        "<hooks json>",
  "--permission-mode", CLAUDE_PERMISSION_MODE,
  "--append-system-prompt", "<closing-summary instruction>",
  "--mcp-config",      "<gui mcp json>",
  "--allowedTools",    "<gui tool names>",
  // optional (spawnBackgroundChat only):
  "--", "<initial prompt>",
], {
  name: "xterm-256color",
  cols: 120, rows: 30,             // initial size; client resizes on connect
  cwd: CLAUDE_CWD,                 // the workspace
  env: process.env,               // full env passthrough
});
```

## Current settings

| # | Setting | Value / source | Purpose | Risk if changed / removed |
|---|---------|----------------|---------|---------------------------|
| 1 | program | `CLAUDE_BIN` (env, default `claude`) — on Windows resolved to an absolute `.exe`, else to a `.cmd`/`.bat` shim run under `cmd.exe` (`infra/resolve-bin.ts`, `infra/cmd-escape.ts`) | The binary run in the PTY | Wrong/missing → spawn fails (now caught: the connection closes with an error instead of crashing the server) |
| 2 | `cwd` | `CLAUDE_CWD` (launcher `--cwd` / env, default `~/mulmoclaude`) | Directory claude runs in. **Also scopes** which `.claude/skills` and (if enabled) `.mcp.json` are picked up, and which `~/.claude/projects/<encoded cwd>` session list the sidebar shows | Change → a different project + session list; missing dir is `mkdir -p`'d |
| 3 | `env` | `process.env` (full passthrough) | claude finds the CLI + tools via `PATH`, and sees `CLAUDE_CWD` / any API keys present | Narrowing risks breaking `PATH` / auth; full passthrough also exposes all server env to the child |
| 4 | `--session-id <uuid>` | new sessions | Server picks the id up front, so it knows the session before claude writes any file | Must be a fresh UUID; reuse collides with an existing session |
| 5 | `--resume <uuid>` | existing sessions | Continue a prior conversation | The session must exist **in this cwd's project**; resuming under the wrong cwd → "not found" |
| 6 | `--settings <hooks json>` | `hookSettingsJson()` | Injects hooks that `curl POST /api/hook` on `UserPromptSubmit` / `Stop` / `Notification` / `Pre`/`Post`ToolUse(`Failure`) → drives the sidebar **working / needs-attention** dots and the **Tools-pane history** | Remove → sidebar goes static, no tool-call history. The hook URL (`localhost:PORT`) must be reachable **from wherever claude runs** (today: same host) |
| 7 | `--permission-mode <mode>` | `CLAUDE_PERMISSION_MODE` (env, default `auto`) | How claude handles tool approval | `auto`/`bypassPermissions` = hands-off; tightening makes it prompt more (in the terminal) |
| 8 | `--append-system-prompt <text>` | `SESSION_SUMMARY_PROMPT` (`server/agents/session-summary-prompt.ts`) | Asks the agent to end a reply with a **closing summary** — the conversation's standing request, what was achieved, what was not — when it hands control back. Not on every turn (#942) | Remove → returning to a cell means scrolling back to learn what was asked. Passed inline, not `--append-system-prompt-file`: the sandbox spawn cannot read a host path |
| 9 | `--mcp-config <gui mcp json>` | `mcpConfigJson()` → `{ type: "http", url: /mcp/<sessionId> }` | Registers the **GUI MCP** server that backs the panel plugins (`presentDocument`, `presentForm`, `generateImage`, …) | Remove → the GUI panel plugins stop working |
| 10 | ~~`--strict-mcp-config`~~ | **removed 2026-08-04** (#1338, #1385) | Used to make `--mcp-config` the ONLY source | It also hid the user's claude.ai connectors, `~/.claude.json`, their plugin servers and the directory's own `.mcp.json` — see the decision below. `rate-limit-probe.ts` still passes it, for startup speed on a hidden session that needs no tools |
| 11 | `--allowedTools <gui tool names>` | `allowedToolNames()` | Auto-allow the GUI MCP tools so they don't trip a permission prompt | Remove → each GUI tool call prompts for approval |
| 12 | `-- <initial prompt>` | `spawnBackgroundChat` only | First message for a headless-spawned session. `--` ends option parsing so a prompt starting with `-` can't be read as a flag | — |
| 13 | `cols` / `rows` | `120` / `30` | Initial PTY size; the client sends a `resize` on connect | Cosmetic initial value only |
| 14 | `name` | `xterm-256color` | `TERM` type for the PTY | Standard; rarely changed |

## How skills & MCP get scoped (the `cwd` story)

Both are resolved by claude **relative to its `cwd`**, which is the key to
per-workspace behaviour:

- **Skills** — claude loads `.claude/skills` (project, relative to `cwd`) **plus**
  `~/.claude/skills` (user). Because we spawn with `cwd = the workspace`, a
  workspace's skills are active **only for that workspace's sessions** — no
  cross-project mixing. This is automatic, and the directory-switch feature
  preserves it (each session keeps its own `cwd`).
- **MCP** — claude loads user MCP (`~/.claude.json`) and project MCP (`.mcp.json`,
  relative to `cwd`), **plus** the GUI MCP we add with `--mcp-config`. Because we
  spawn with `cwd = the workspace`, a workspace's MCP servers are active only for
  that workspace's sessions, exactly as its skills are.

## Decision: MCP scoping — settled on B, 2026-08-04

| | A. Keep `--strict-mcp-config` | **B. Drop it (like mulmoclaude) — TAKEN** |
|---|---|---|
| MCP loaded | GUI MCP only | GUI MCP **+** user (`~/.claude.json`) **+** project (`.mcp.json`), all `cwd`-scoped |
| Workspace MCP | ❌ not available | ✅ works, naturally **per-workspace** (same isolation as skills) |
| Predictability | ✅ minimal, fixed surface | ⚠️ depends on each project's `.mcp.json` |
| Trust prompts | none | project `.mcp.json` triggers a "trust this server?" prompt (handled in the interactive terminal) |
| GUI MCP coexistence | n/a | verified — see the spike below |
| Resources | one MCP (HTTP, in-process) | + one process per project MCP server, per session |
| Permission interaction | simple | unchanged: `--allowedTools` is an additive allowlist, not "only these" |

A was not merely less consistent — it was **the bug** in #1338 and #1385. Attaching
the GUI panel also cut the session off from the user's claude.ai connectors
(Gmail / Calendar / Drive / Slack), `~/.claude.json`, their plugin MCP servers and
the directory's own `.mcp.json`, because the two flags were pushed on one line.

**The spike this section asked for**, run in `~/mulmoclaude` on **CLI 2.1.221**,
reading `mcp_servers` off the `system`/`init` event:

| spawn | `init.mcp_servers` |
|---|---|
| `--mcp-config` alone | **3** — our broker + `claude.ai Superhuman Docs` + `claude.ai Gmail` |
| `--mcp-config --strict-mcp-config` | **1** — our broker alone |

So the GUI MCP and the user's own servers coexist; the #1043 worry that a merge
silently drops our broker does not reproduce. MulmoClaude reached the same
conclusion at CLI 2.1.163 and has run without the flag since.

**What B costs, accepted with it:**

- **Startup.** A workspace cell now loads the user's MCP servers. The
  `rate-limit-probe.ts` measurement is the same effect in reverse: 8.0 s to first
  window with no servers, 9–15 s with one unauthenticated one.
- **Overlapping tool names**, for a directory that registered tool groups in its own
  `.mcp.json` — the group URLs are no longer shut out, so the same tool could arrive
  as both `mcp__mt__presentChart` and `mcp__mulmoterminal-render__presentChart`.
  Resolved on our side, not by a flag: a session handed the all-tools URL is recorded
  at spawn (`claimFullGuiMcp`), and the group URLs then offer it nothing
  (`mcp/tool-gate.ts`). Doing it the obvious way instead — withholding the GUI MCP
  when groups are registered — would re-break #1188, because groups do not cover the
  ungrouped tools.

## Interaction with the directory-switch feature

- A new session inherits the **active workspace's `cwd`** → its skills (and, under
  B, its MCP). A **resumed** session keeps its **original `cwd`**. So switching
  workspaces never mixes skills/MCP across projects.
- GUI stores (`.toolresults` / `.toolcalls`) were centralized to
  `~/.mulmoterminal/` (#42), so they're directory-independent. `artifacts/`
  (generated docs/charts) intentionally stays under the workspace `cwd` because
  claude references it relative to its `cwd`.

## Note for "run claude elsewhere" (e.g. Docker)

Settings #6 (hook URL) and #9 (MCP URL) are `localhost`/`127.0.0.1` — they assume
claude runs on the **same host** as the server. If claude is ever run in a
container, those must point at the host (e.g. `host.docker.internal`), and `cwd` /
auth (`~/.claude`) must be mounted. (See the abandoned PR #30 for prior art.)
