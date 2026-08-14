import { describe, it, expect } from "vitest";
import { FULL_GUI_MCP_AGENTS, agentCarriesFullGuiMcp, pickCarriesFullGuiMcp } from "../../common/guiMcpAgents";
import { SESSION_AGENTS } from "../../common/sessionAgent";
import type { CustomAgent } from "../../common/customAgents";

// Which agents are handed every GUI tool in the workspace. This lives in common/ because the server
// decides it (by which spawn calls carriesFullGuiMcp) and the launcher form decides FROM it — while
// it was implicit in the server the form could not ask, so it asked the directory alone and told an
// antigravity session it had every tool while hiding the switches (#1423).
describe("agentCarriesFullGuiMcp", () => {
  it("covers claude and codex", () => {
    expect(agentCarriesFullGuiMcp("claude")).toBe(true);
    expect(agentCarriesFullGuiMcp("codex")).toBe(true);
  });

  // The asymmetry this module exists to make explicit, with the REASON in the test so a later
  // reader can judge whether it still holds: antigravity reads a per-directory MCP config file it
  // is pointed at, so there is no per-spawn URL to hand it. Adding it here would make the form
  // promise tools no spawn path delivers.
  it("excludes antigravity, which reaches MCP through a per-directory file instead", () => {
    expect(agentCarriesFullGuiMcp("antigravity")).toBe(false);
  });

  it("excludes shell, which is not an agent session at all", () => {
    expect(agentCarriesFullGuiMcp("shell")).toBe(false);
  });

  // Every session kind must have an answer here, so adding a fourth agent cannot silently inherit
  // one side's default: this fails the moment SESSION_AGENTS grows without a decision being made.
  it("answers for every session agent", () => {
    for (const agent of SESSION_AGENTS) expect(typeof agentCarriesFullGuiMcp(agent)).toBe("boolean");
    expect([...FULL_GUI_MCP_AGENTS].every((agent) => SESSION_AGENTS.some((known) => known === agent))).toBe(true);
  });
});

describe("pickCarriesFullGuiMcp", () => {
  const nemotron: CustomAgent = { id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --" };

  it("reads a custom agent's declared CLI, not its command text", () => {
    expect(pickCarriesFullGuiMcp("custom:nemotron", [nemotron])).toBe(true);
  });

  // The command names `claude`, but the entry is what decides — and here it declares nothing this
  // list covers. Nothing in this repo parses a command line to infer an agent.
  it("does not infer the agent from the command line", () => {
    const codexish: CustomAgent = { id: "x", label: "X", agent: "claude", command: "wrapper codex --" };
    expect(pickCarriesFullGuiMcp("custom:x", [codexish])).toBe(true);
  });

  it("answers false for a custom pick whose entry is gone", () => {
    expect(pickCarriesFullGuiMcp("custom:deleted", [])).toBe(false);
  });

  it("passes the built-ins straight through", () => {
    expect(pickCarriesFullGuiMcp("claude", [])).toBe(true);
    expect(pickCarriesFullGuiMcp("codex", [])).toBe(true);
    expect(pickCarriesFullGuiMcp("antigravity", [])).toBe(false);
    expect(pickCarriesFullGuiMcp("shell", [])).toBe(false);
  });
});
