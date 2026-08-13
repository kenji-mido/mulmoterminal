// The `claude --mcp-config` payload every spawned session carries.
//
// Points claude at the in-process GUI MCP server served over Streamable HTTP. The session id
// rides in the URL path (the MCP server is otherwise stateless), so no env var and no
// subprocess are needed — the agent just calls back into this server.
//
// Pure, with the port and the user's servers passed in: index.ts read both from module state,
// so the precedence rule below could not be tested without booting the server (#548).
import type { UserMcpServer } from "../config/config-schema.js";
import { toolGroupServerId, GUI_SERVER_ID, type ToolGroup } from "../../common/toolGroups.js";
import { isWorkspaceCwd } from "../config/env.js";
import type { GuiMcpServer } from "../agents/codex-args.js";

export interface McpConfigInput {
  sessionId: string;
  // 127.0.0.1 rather than localhost avoids an IPv6/IPv4 resolution mismatch against the
  // server's listen address.
  host?: string | undefined;
  port: string | number;
  // The user's own HTTP MCP servers (Settings).
  userMcpServers: readonly UserMcpServer[];
}

const DEFAULT_HOST = "127.0.0.1";

/**
 * Does this session carry the WHOLE GUI MCP — every tool on the one `mt` URL — rather than the
 * per-group URLs a directory registered for itself? Two ways to earn it, and they are different
 * facts that used to be one flag:
 *
 *   `attachGuiMcp` — not a grid cell at all: the single view, or a chat spawned with no cell yet.
 *   the CWD        — anything running in the workspace itself. Starting a terminal there is all
 *                    but the same thing as running the single view, and that equivalence is what
 *                    lets the single view eventually go.
 *
 * A session in a PROJECT directory is false on both counts and takes exactly the branch it took
 * before any of this. Named and exported rather than left inline because that last sentence is the
 * invariant the whole design is written around, and an invariant nothing can assert is just a hope.
 *
 * It lives HERE, next to the two payload builders, because all three agents now ask it — claude's
 * argv, codex's `-c` overrides, and the launcher chip's rewritten command line. It was a local
 * detail of spawn-claude.ts while claude was the only caller.
 *
 * This is also WHY THE TOOL NAMES DIFFER between cells, which looks like a bug until you know it:
 * true carries every tool under one generated server id (`mt`), so the agent sees
 * `mcp__mt__presentChart`; false picks the tools up from the user's per-folder config under the
 * group ids, so the SAME tool is `mcp__mulmoterminal-render__presentChart`. Neither name is stale.
 * See common/toolGroups.ts for why the two ids are not unified, and README's "MCP server ids".
 */
export const carriesFullGuiMcp = (attachGuiMcp: boolean, cwd: string | undefined): boolean => attachGuiMcp || isWorkspaceCwd(cwd);

// The counterpart for GRID cells, which are handed no --mcp-config at all: their GUI tools
// come from the user's OWN per-folder MCP config (`claude mcp add -s local`, `.mcp.json`),
// where the URL is a static string and cannot carry a session id. Claude Code expands
// `${VAR}` in an MCP url at connect time, so the two moving parts ride in the environment:
//
//   "url": "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/render/${MULMOTERMINAL_SESSION_ID}"
//
// Set on every claude spawn, not just grid ones — the single view carries its own config and
// simply never reads these, and a session that starts in one view is not worth special-casing.
export function guiMcpEnv(sessionId: string, port: string | number): Record<string, string> {
  return { MULMOTERMINAL_PORT: String(port), MULMOTERMINAL_SESSION_ID: sessionId };
}

// The same two surfaces, spelled for CODEX, which takes them as `-c mcp_servers.<id>.url=` at
// spawn instead of reading a config file. It has no `${VAR}` expansion, so unlike the template
// above these are resolved here — which is possible precisely because they are built per spawn.
//
// The GROUPS are the directory's, read from Claude Code's config by the caller: one switch in the
// launcher, both agents. A grid cell whose directory registered nothing gets an empty list and
// therefore no GUI tools, which is what it had before.
//
// AUTO-APPROVAL does not carry over cleanly, and the difference is decided here. claude is handed
// a list of TOOLS (`--allowedTools`, from AUTO_ALLOWED_TOOLS) and that list deliberately withholds
// the ones that can spend money — presentDocument resolves image placeholders through the image
// backend, and the whole `media` group generates. codex approves per SERVER, so the same list
// cannot be expressed: a group is waved through as a whole, or every call in it asks.
//
// It is waved through, by the owner's decision (2026-07-28). Prompting on every drawing call is
// what the flag was added to the single view to avoid, and the single view has carried the whole
// GUI MCP — generateImage included — approved wholesale since it was wired. So a codex cell can
// spend on presentDocument / generateImage / presentMulmoScript without asking, and a claude cell
// in the same directory still asks. That asymmetry is intentional and it is codex's approval
// model, not an oversight.
//
// If it should ever be narrowed, this is the one place: `autoApprove` is a per-server property so
// the policy stays a value here rather than a flag scattered through the argv builder.
export function codexGuiMcpServers({
  sessionId,
  host = DEFAULT_HOST,
  port,
  groups,
  allTools,
}: {
  sessionId: string;
  host?: string | undefined;
  port: string | number;
  groups: readonly ToolGroup[];
  /** The single view, which carries every tool on one URL rather than a URL per group. */
  allTools: boolean;
}): GuiMcpServer[] {
  const base = `http://${host}:${port}/api/mcp`;
  if (allTools) return [{ id: GUI_SERVER_ID, url: `${base}/${sessionId}`, autoApprove: true }];
  return groups.map((group) => ({ id: toolGroupServerId(group), url: `${base}/${group}/${sessionId}`, autoApprove: true }));
}

export function mcpConfigJson({ sessionId, host = DEFAULT_HOST, port, userMcpServers }: McpConfigInput): string {
  const mcpServers: Record<string, { type: string; url: string }> = {};
  // The user's servers go in FIRST so the built-in GUI entry below always wins on a clashing id.
  // This is where that collision is settled — sanitizeUserMcpServers deliberately KEEPS an entry
  // named like ours (erasing it would destroy a line of the user's own config on the next save),
  // so the last write here is what stops it shadowing the built-in.
  for (const server of userMcpServers) {
    mcpServers[server.id] = { type: "http", url: server.url };
  }
  mcpServers[GUI_SERVER_ID] = { type: "http", url: `http://${host}:${port}/api/mcp/${sessionId}` };
  return JSON.stringify({ mcpServers });
}

/**
 * What a full-GUI-MCP session pre-approves: our own tools, plus the user's Settings servers by id.
 *
 * Both halves matter, and the second is the one that surprises. The generated `--mcp-config`
 * INCLUDES `userMcpServers` (above), so those servers arrive through our payload rather than
 * through the user's own config — and pre-approving them here is what stops each of their tools
 * raising a permission prompt, which is the behaviour the single view has always had.
 *
 * Only what WE hand over is pre-approved. The servers Claude Code loads on its own — the
 * directory's `.mcp.json`, the claude.ai connectors, `~/.claude.json` — prompt as they do in any
 * other cell; they became reachable here when `--strict-mcp-config` was dropped (#1338, #1385),
 * and that is a scoping fix, not a licence to auto-allow someone else's tools.
 *
 * Shared rather than spelled out at each spawn because the two callers — a claude cell and a
 * launcher chip running claude — are supposed to be indistinguishable, and this PR exists because
 * they had drifted. Two copies of a join is exactly how they drift again.
 */
export const fullGuiAllowedTools = (guiMcpTools: string, userMcpServers: readonly UserMcpServer[]): string =>
  [guiMcpTools, ...userMcpServers.map((server) => `mcp__${server.id}`)].join(",");
