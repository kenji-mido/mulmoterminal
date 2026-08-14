// The stdio GUI MCP bridge, and which server ids in a user's config file are OURS to rewrite.
//
// Shared by the two agents that reach MCP through a CONFIG FILE rather than a per-spawn flag —
// antigravity (`.agents/mcp_config.json`) and grok (`.grok/config.toml`). claude and codex are
// handed a session-scoped URL at spawn and need none of this.
//
// The bridge is what makes a file-registered server session-aware at all. A URL written into a
// shared file cannot carry a session id — the file is per DIRECTORY and outlives every session in
// it — so the id travels in the agent process's ENVIRONMENT (guiMcpEnv) and the stdio bridge, being
// a child of that process, inherits it. That indirection is the whole reason a stdio bridge exists
// instead of the http entry the same broker also serves.
import { fileURLToPath } from "node:url";
import { TOOL_GROUPS, toolGroupServerId, LEGACY_GUI_SERVER_IDS } from "../../common/toolGroups.js";

// The absolute path of the node running THIS server, not the name `node`: the bridge is spawned by
// the agent, whose PATH is the user's login shell's and need not have the same node (nvm) on it.
export const bridgeCommand = (): { command: string; args: string[] } => ({
  command: process.execPath,
  args: [fileURLToPath(new URL("../mcp/bridge.mjs", import.meta.url))],
});

// Exactly the ids these paths have ever WRITTEN, and nothing else — an id in here is an id we
// delete out of a file the user owns.
//
// `GUI_SERVER_ID` is deliberately NOT in it: the file paths only ever write per-group ids, and the
// all-tools entry belongs to the claude/codex spawn config. Listing it would mean a user's own
// server called `mt` is deleted on the next sync, by code that never created it (Codex review on
// #1355). The LEGACY ids stay because an older version really did write the all-tools entry, and
// cleaning that up is what stops it outliving the code that made it.
export const OUR_GUI_SERVER_IDS: ReadonlySet<string> = new Set([...LEGACY_GUI_SERVER_IDS, ...TOOL_GROUPS.map(toolGroupServerId)]);
