// @vitest-environment node
// The badge a session row wears to say which agent it runs (#1096). Read by the sidebar and the
// tab bar, which show the SAME list — comparing a literal in each is how they came to disagree
// about a third agent, so the wording lives in one place and is pinned here.
import { describe, it, expect } from "vitest";
import { agentBadge, TERMINAL_AGENTS } from "../../common/sessionAgent";

describe("agentBadge", () => {
  it("badges codex", () => {
    expect(agentBadge("codex")).toEqual({ full: "codex", short: "cx" });
  });

  it("badges antigravity by the name its CLI goes by", () => {
    expect(agentBadge("antigravity")).toEqual({ full: "agy", short: "agy" });
  });

  // Claude is the default everywhere, so badging it would put one on nearly every row and stop
  // the badge meaning "this one is different".
  it("gives claude no badge", () => {
    expect(agentBadge("claude")).toBeNull();
  });

  it.each([
    ["a shell, which is not an agent", "shell"],
    ["an agent this build has never heard of", "some-future-agent"],
    ["a claude session, which carries no agent at all", undefined],
    ["nothing", null],
    ["an empty string", ""],
  ])("gives %s no badge", (_label, agent) => {
    expect(agentBadge(agent)).toBeNull();
  });

  // The tab bar fits about two characters. A short form that is not short defeats the point.
  it("keeps every short form to two or three characters", () => {
    TERMINAL_AGENTS.forEach((agent) => {
      const badge = agentBadge(agent);
      if (badge) expect(badge.short.length).toBeLessThanOrEqual(3);
    });
  });
});
