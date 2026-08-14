// Which GUI MCP surface muse gets, asserted where both sides read it: the launcher form decides
// from this list what it tells the user (#1423), and the server decides from it what it hands a
// spawn.
//
// muse is the third answer to that question. It is NOT in FULL_GUI_MCP_AGENTS — it takes no
// per-spawn `--mcp-config`, so a session in the workspace does not get every tool on one url — and
// it does not read a per-directory config file either. Its servers come from an installed PLUGIN,
// registered once per machine, narrowed back to the directory's groups by a record the bridge asks
// for after it resolves which session it belongs to (server/agents/muse-mcp.ts,
// server/session/bridge-session.ts).
import { describe, it, expect } from "vitest";
import { agentCarriesFullGuiMcp, FULL_GUI_MCP_AGENTS } from "../../../common/guiMcpAgents.js";
import { carriesFullGuiMcp } from "../../../server/session/mcp-config.js";
import { entitledToolGroups, rememberEntitledToolGroups, forgetEntitledToolGroups } from "../../../server/session/bridge-session.js";

describe("muse and the GUI MCP", () => {
  it("carries no per-spawn MCP config, in the workspace or anywhere else", () => {
    expect(agentCarriesFullGuiMcp("muse")).toBe(false);
    expect(carriesFullGuiMcp(true, undefined, "muse")).toBe(false);
    expect([...FULL_GUI_MCP_AGENTS]).not.toContain("muse");
  });

  // The agents that DO get one, asserted beside it so a change to the list has to face both.
  it("leaves claude and codex carrying it", () => {
    expect(agentCarriesFullGuiMcp("claude")).toBe(true);
    expect(agentCarriesFullGuiMcp("codex")).toBe(true);
  });

  // Where muse's tools actually come from. Not the environment — a plugin's MCP server inherits
  // none of ours — but a record the bridge asks for once it has resolved which session it serves.
  it("records the directory's groups against the session for the bridge to ask for", () => {
    rememberEntitledToolGroups("s-1", ["render", "data"]);
    expect(entitledToolGroups("s-1")).toEqual(["render", "data"]);
    forgetEntitledToolGroups("s-1");
  });

  // An unknown session reaches NOTHING. A bridge asking about a session this server has no record
  // of is one it cannot vouch for, and defaulting to every tool would be the wrong way to be wrong.
  it("gives an unrecorded session no groups at all", () => {
    expect(entitledToolGroups("never-seen")).toEqual([]);
  });
});
