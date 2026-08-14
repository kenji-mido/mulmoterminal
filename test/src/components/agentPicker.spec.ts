import { describe, it, expect } from "vitest";
import { AGENT_PICKER_OPTIONS, agentPickerOptions } from "../../../src/components/agentPicker";
import { LAUNCH_AGENTS } from "../../../common/launchAgent";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";
import type { CustomAgent } from "../../../common/customAgents";

describe("AGENT_PICKER_OPTIONS (#1114)", () => {
  it("puts the agents first — Claude leading, since it is the default — and the shell last", () => {
    expect(AGENT_PICKER_OPTIONS.map((o) => o.agent)).toEqual([...TERMINAL_AGENTS, "shell"]);
  });

  // Two lists, one set. LAUNCH_AGENTS is what a phone may ask the grid to start (#831); this is
  // what the Agent Picker offers. An agent added to one alone is startable from the phone but not
  // from the app it is displayed in, or the reverse — and neither side would fail to build.
  it("covers exactly the agents a cell can be launched as", () => {
    expect([...AGENT_PICKER_OPTIONS.map((o) => o.agent)].sort()).toEqual([...LAUNCH_AGENTS].sort());
  });

  it("labels every option", () => {
    expect(AGENT_PICKER_OPTIONS.filter((o) => !o.label.trim())).toEqual([]);
  });

  // The point of the option is that it needs nothing installed and nothing configured, which its
  // one-word label cannot say — so the hover has to name what it runs.
  it("says what the shell option runs", () => {
    expect(AGENT_PICKER_OPTIONS.find((o) => o.agent === "shell")?.title).toContain("$SHELL");
  });
});

describe("agentPickerOptions — the user's own agents (#1414)", () => {
  const nemotron: CustomAgent = { id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --model nemotron-3-ultra:cloud --" };

  it("is the built-in list unchanged when none are configured", () => {
    expect(agentPickerOptions([])).toEqual(AGENT_PICKER_OPTIONS);
  });

  // WITH the agents, not after Shell. A custom agent starts a real Claude Code session — it
  // resumes, it reports cost, the GUI tools reach it — so grouping it past the shell would put it
  // beside the one control it is most likely to be confused with (the launcher chips).
  it("puts a custom agent after the built-in agents and before Shell", () => {
    expect(agentPickerOptions([nemotron]).map((o) => o.agent)).toEqual([...TERMINAL_AGENTS, "custom:nemotron", "shell"]);
  });

  // The label is a name the user chose; "Nemotron" alone cannot say which binary the click runs.
  it("names the command in the hover, since the label cannot", () => {
    const option = agentPickerOptions([nemotron]).find((o) => o.agent === "custom:nemotron");
    expect(option?.label).toBe("Nemotron");
    expect(option?.title).toContain("ollama launch claude");
  });
});
