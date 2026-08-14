// Which agents are handed the WHOLE GUI MCP — every tool on one generated `mt` URL — when their
// session runs in the workspace, and which reach GUI tools only through what their directory
// registered.
//
// In `common/` because BOTH sides decide from it and neither can derive it: the server decides it
// by which spawn path consults `carriesFullGuiMcp`, and the launcher form decides from it whether
// to state "All of them, automatically" or to offer the four per-group toggles. While the agent
// dimension lived only in the server — implicit in which file called what — the form could not ask,
// so it asked the DIRECTORY alone and told an Antigravity session in the workspace that it had
// every tool while hiding the only control that could have given it any (#1423).
//
// Antigravity is out for a structural reason, not an oversight: it reaches MCP through a config
// FILE it reads for itself (`syncAntigravityMcpConfig` writes the registered group servers into the
// directory), so there is no per-spawn `--mcp-config` to hand it a session-scoped URL. Claude takes
// that URL in its argv and codex in its `-c` overrides; agy has nowhere to receive one.
//
// Grok is out for exactly the same reason, and it is written down here rather than left to be
// rediscovered: `grok` has no `--mcp-config` and no `-c key=value`, only `grok mcp add` writing
// `~/.grok/config.toml` or `./.grok/config.toml` (server/agents/grok-mcp.ts). So a grok session in
// the workspace gets the groups its DIRECTORY registered, and the launcher form offers it the four
// per-group toggles — which is the truthful answer, and the one #1423 failed to give.
//
// Muse is out for the same reason and reaches its tools a third way. It has no `--mcp-config` and
// no per-directory config file either: MCP servers are declared by an installed PLUGIN, which
// `muse plugins install` records per MACHINE (server/agents/muse-mcp.ts). So MulmoTerminal
// registers one plugin holding all four group servers, and each SESSION is narrowed back to what
// its directory switched on — by a lookup, not by the environment: a plugin's MCP server is started
// with a curated environment that carries nothing of ours, so the bridge resolves which session it
// belongs to (by its process tree) and is told the groups with the answer. Do not add a bridge
// environment variable; it is dropped on the way and the failure is silent. The launcher form offers muse the same four per-group
// toggles as grok and agy, which is the truthful answer for the same reason it is theirs.
import { type SessionAgent } from "./sessionAgent.js";
import { isLaunchAgent } from "./launchAgent.js";
import { customAgentFor, type AgentPick, type CustomAgent } from "./customAgents.js";

export const FULL_GUI_MCP_AGENTS = ["claude", "codex"] as const;

export type FullGuiMcpAgent = (typeof FULL_GUI_MCP_AGENTS)[number];

export const agentCarriesFullGuiMcp = (agent: SessionAgent): agent is FullGuiMcpAgent => FULL_GUI_MCP_AGENTS.some((candidate) => candidate === agent);

/** The same question asked of an Agent Picker choice, which may name one of the user's own entries.
 *
 *  A custom agent IS the CLI its entry declares: the user's command is a wrapper and Claude Code's
 *  whole argv — `--mcp-config` included — is appended to it, so it receives what that CLI receives.
 *  Reading `entry.agent` rather than the command text is the point; nothing here parses a command.
 *
 *  A `custom:` pick whose entry is gone (a cell outliving its config) answers false: its CLI is no
 *  longer knowable, and offering the per-group toggles is the harmless way to be wrong. */
export const pickCarriesFullGuiMcp = (pick: AgentPick, customAgents: readonly CustomAgent[]): boolean => {
  const custom = customAgentFor(pick, customAgents);
  if (custom) return agentCarriesFullGuiMcp(custom.agent);
  return isLaunchAgent(pick) && agentCarriesFullGuiMcp(pick);
};
