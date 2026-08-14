import { describe, it, expect } from "vitest";
import { customAgentFor, customAgentIdOf, customAgentPick, isCustomAgent, isCustomAgentId, type CustomAgent } from "../../common/customAgents";
import { LAUNCH_AGENTS } from "../../common/launchAgent";

const nemotron: CustomAgent = { id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --model nemotron-3-ultra:cloud --" };

describe("custom agent ids (#1414)", () => {
  it("accepts a lowercase slug", () => {
    expect(isCustomAgentId("nemotron")).toBe(true);
    expect(isCustomAgentId("kimi-k2")).toBe(true);
    // Underscores too — they are what people actually type, and rejecting them dropped the
    // entry silently, which reads as the config never having been saved.
    expect(isCustomAgentId("kimi_k3")).toBe(true);
    expect(isCustomAgentId("glm_52")).toBe(true);
  });

  // A picker button whose id is "claude" would be shadowed by the built-in one and never
  // reachable — which reads as the config having been ignored, not as a naming clash.
  it("refuses every built-in picker option as an id", () => {
    for (const builtin of LAUNCH_AGENTS) expect(isCustomAgentId(builtin)).toBe(false);
  });

  it("refuses spellings that would make two ids look like one", () => {
    expect(isCustomAgentId("Nemotron")).toBe(false); // compared exactly on both sides of the wire
    expect(isCustomAgentId("my agent")).toBe(false); // travels in a query string
    expect(isCustomAgentId("-lead")).toBe(false);
    expect(isCustomAgentId("")).toBe(false);
  });
});

describe("the Agent Picker's value", () => {
  it("round-trips a custom id through the pick", () => {
    expect(customAgentIdOf(customAgentPick("nemotron"))).toBe("nemotron");
  });

  // The prefix is what keeps `pick === "shell"` a checkable comparison rather than a string
  // compare against an open type — so a built-in must never read as a custom agent.
  it("reads a built-in as no custom agent at all", () => {
    for (const builtin of LAUNCH_AGENTS) expect(customAgentIdOf(builtin)).toBeNull();
    expect(customAgentIdOf(null)).toBeNull();
    expect(customAgentIdOf("custom:")).toBeNull();
  });

  // A cell outlives the config entry it was launched from: the user can delete one while a
  // session started on it is still open, and the picker must then answer "not configured"
  // rather than a half-populated entry.
  it("resolves a pick to its entry, or null when it is gone", () => {
    expect(customAgentFor("custom:nemotron", [nemotron])).toEqual(nemotron);
    expect(customAgentFor("custom:nemotron", [])).toBeNull();
    expect(customAgentFor("claude", [nemotron])).toBeNull();
  });
});

describe("isCustomAgent — the wire/config row", () => {
  it("accepts a complete row", () => {
    expect(isCustomAgent(nemotron)).toBe(true);
  });

  it("refuses a row missing any of the three, or with a blank one", () => {
    expect(isCustomAgent({ id: "nemotron", label: "Nemotron", agent: "claude" })).toBe(false);
    expect(isCustomAgent({ id: "nemotron", label: "  ", agent: "claude", command: "x" })).toBe(false);
    expect(isCustomAgent({ id: "nemotron", label: "Nemotron", agent: "claude", command: "  " })).toBe(false);
    expect(isCustomAgent({ id: "Nemotron", label: "Nemotron", agent: "claude", command: "x" })).toBe(false);
    expect(isCustomAgent({ id: "nemotron", label: "Nemotron", command: "x" })).toBe(false); // no agent named — nothing to append
    expect(isCustomAgent(null)).toBe(false);
  });
});
