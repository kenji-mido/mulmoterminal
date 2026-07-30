import { describe, it, expect } from "vitest";
import { LAUNCH_TARGETS } from "../../../src/components/launchTargets";
import { LAUNCH_AGENTS } from "../../../common/launchAgent";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";

describe("LAUNCH_TARGETS (#1114)", () => {
  it("puts the agents first — Claude leading, since it is the default — and the shell last", () => {
    expect(LAUNCH_TARGETS.map((t) => t.agent)).toEqual([...TERMINAL_AGENTS, "shell"]);
  });

  // Two lists, one set. LAUNCH_AGENTS is what a phone may ask the grid to start (#831); this is
  // what the launch form offers. An agent added to one alone is startable from the phone but not
  // from the app it is displayed in, or the reverse — and neither side would fail to build.
  it("covers exactly the agents a cell can be launched as", () => {
    expect([...LAUNCH_TARGETS.map((t) => t.agent)].sort()).toEqual([...LAUNCH_AGENTS].sort());
  });

  it("labels every target", () => {
    expect(LAUNCH_TARGETS.filter((t) => !t.label.trim())).toEqual([]);
  });

  // The point of the option is that it needs nothing installed and nothing configured, which its
  // one-word label cannot say — so the hover has to name what it runs.
  it("says what the shell option runs", () => {
    expect(LAUNCH_TARGETS.find((t) => t.agent === "shell")?.title).toContain("$SHELL");
  });
});
