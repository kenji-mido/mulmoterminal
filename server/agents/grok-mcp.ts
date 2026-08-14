// The GUI MCP registration for `grok`, written where grok actually reads one per project:
// `./.grok/config.toml`, its project-scope config.
//
// grok is antigravity-shaped here (a config FILE, no per-spawn flag), so the same two rules apply
// and for the same reasons:
//
//   - the TOOL GROUP is a property of the directory, so it goes in the entry's own `env`;
//   - the SESSION is not, so it never appears here. It reaches the bridge through the grok
//     process's environment (guiMcpEnv, set per spawn) and only there. A session id written into
//     this file would be handed to every later session in the directory — one stale id, minted
//     once and then frozen, sending every session's tool results to a channel nobody listens on.
//
// WHAT IS DIFFERENT, and why this file does not look like antigravity-mcp.ts: that file is JSON, so
// it can be parsed, merged and re-serialised losslessly. This one is TOML AND IT IS THE USER'S —
// rewriting it without a TOML library would drop their comments and formatting, and adding one to
// round-trip a file we only ever add two lines to is a large dependency for a small write.
//
// So grok's OWN CLI does the writing: `grok mcp add -s project` / `grok mcp remove -s project`.
// It costs a subprocess per changed group (measured at ~0.16s each against grok 0.2.118), which is
// why the diff below exists — the common case, a directory whose groups have not changed since the
// last session started there, reads one file and spawns nothing. It is the slower of the two
// designs and the only one that cannot corrupt a file someone hand-wrote.
//
// Claude Code's own config remains the registry of WHICH groups a directory has (see
// infra/gui-mcp-registration.ts) — one switch in the launcher, every agent. This file is derived
// from it; it is never read back to answer what is registered, only to answer what we already
// wrote here.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_GROUPS, toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";
import { bridgeCommand, OUR_GUI_SERVER_IDS } from "./gui-mcp-bridge.js";
import { excludeFromGit } from "./git-exclude.js";
import { grokAdapter } from "./grok.js";

/** grok's project-scope config, the one `grok mcp add -s project` writes. */
export const grokMcpConfigFile = (cwd: string): string => path.join(cwd, ".grok", "config.toml");

// Which of OUR server ids the file currently declares.
//
// A deliberately TEXTUAL scan rather than a TOML parse, and it is allowed to be one because of what
// it is asked: only whether a `[mcp_servers.<our id>]` table is present. Our ids are a closed,
// known set of plain identifiers, so a false negative costs one redundant `grok mcp add` (which is
// documented as "add or update", i.e. idempotent) and a false positive is not reachable — nothing
// else writes those exact table headers. Nothing here decides what to KEEP, so a misread cannot
// lose a line of the user's config; the removals below name only ids from this same closed set.
export function declaredGuiMcpServers(file: string): Set<string> {
  const found = new Set<string>();
  if (!existsSync(file)) return found;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return found;
  }
  for (const id of OUR_GUI_SERVER_IDS) {
    // The table header for a bare-key id, at the start of a line: `[mcp_servers.mulmoterminal-render]`.
    // A quoted key (`["mulmoterminal-render"]`) is not something `grok mcp add` writes, so an entry
    // spelled that way by hand reads as absent and is simply re-added under the bare form.
    if (new RegExp(`^\\s*\\[mcp_servers\\.${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m").test(text)) found.add(id);
  }
  return found;
}

/** What the file should declare for `groups`, as ids. */
const desiredGuiMcpServers = (groups: readonly ToolGroup[]): Set<string> => new Set(groups.map(toolGroupServerId));

/** The two lists a sync has to act on: ids to register, ids of OURS to drop. Pure, so the "never
 *  touch a server we do not own" rule is testable without a filesystem or a subprocess. */
export function planGrokMcpSync(declared: ReadonlySet<string>, groups: readonly ToolGroup[]): { add: string[]; remove: string[] } {
  const desired = desiredGuiMcpServers(groups);
  // TOOL_GROUPS order, not Set order, so the argv a spec asserts on is stable.
  const add = TOOL_GROUPS.map(toolGroupServerId).filter((id) => desired.has(id) && !declared.has(id));
  const remove = [...declared].filter((id) => !desired.has(id));
  return { add, remove };
}

/** The group an id was registered for — the inverse of toolGroupServerId, over the closed set. */
const groupOfServerId = (id: string): ToolGroup | null => TOOL_GROUPS.find((group) => toolGroupServerId(group) === id) ?? null;

// `-s project` on both verbs: without it `add` writes the USER config (its default), which would
// give every directory on the machine the tools that ONE directory switched on, and `remove`
// searches every scope — which would delete a user-scope server someone registered themselves.
//
// The scope is passed by the CALLER, before the command word, and that placement is the whole
// reason this takes it as a parameter rather than appending it here. `grok mcp add` ends in
// `<command> -- <args…>`, and everything after the `--` belongs to the server being registered:
// appending the flag put `-s project` into the BRIDGE's argv, where grok never saw it — so the add
// silently fell back to user scope and wrote four entries into the developer's own
// `~/.grok/config.toml`. It succeeded, exit code 0, with the project file untouched. Caught only by
// running it against a real directory and looking at the file afterwards.
function runGrokMcp(cwd: string, args: string[]): void {
  execFileSync(grokAdapter.bin(), ["mcp", ...args], { cwd, stdio: "ignore", timeout: 15_000 });
}

/** The argv for registering one group's bridge, scope first and the `--` last. Split out so the
 *  ordering that broke once is asserted by a spec rather than trusted. */
export function grokMcpAddArgs(id: string, group: ToolGroup, bridge: { command: string; args: string[] }): string[] {
  return ["add", id, "-s", "project", "-t", "stdio", "-e", `MULMOTERMINAL_TOOL_GROUP=${group}`, bridge.command, "--", ...bridge.args];
}

export const grokMcpRemoveArgs = (id: string): string[] => ["remove", id, "-s", "project"];

// Point this directory's grok sessions at the GUI MCP for exactly `groups`. Idempotent, and cheap
// when nothing changed: a directory already in the desired state spawns no subprocess at all.
export function syncGrokMcpConfig(cwd: string, groups: readonly ToolGroup[]): void {
  const file = grokMcpConfigFile(cwd);
  const { add, remove } = planGrokMcpSync(declaredGuiMcpServers(file), groups);
  if (add.length === 0 && remove.length === 0) return;

  // Kept out of `git status` only when the file is OURS — i.e. it did not exist before this sync.
  // The asymmetry with agy's `.agents/mcp_config.json` is deliberate: that path writes a file
  // nothing else uses, while `.grok/config.toml` is a project config a team may well have
  // committed on purpose, and excluding a tracked file someone else wrote would hide their own
  // edits to it from them.
  const ours = !existsSync(file);

  const bridge = bridgeCommand();
  for (const id of remove) {
    try {
      runGrokMcp(cwd, grokMcpRemoveArgs(id));
    } catch (err) {
      console.warn(`[grok] could not remove MCP server ${id} in ${cwd}: ${err}`);
    }
  }
  for (const id of add) {
    const group = groupOfServerId(id);
    if (!group) continue;
    try {
      runGrokMcp(cwd, grokMcpAddArgs(id, group, bridge));
    } catch (err) {
      // A read-only project, or no grok on PATH, is a reason for grok to have no GUI tools there —
      // not for the session to fail to start.
      console.warn(`[grok] could not register MCP server ${id} in ${cwd}: ${err}`);
    }
  }
  if (ours && existsSync(file)) excludeFromGit(cwd, ".grok/config.toml");
}
