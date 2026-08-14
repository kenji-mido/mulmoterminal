import { describe, it, expect } from "vitest";

import { isOfferable, notOfferedReason } from "../../../src/components/launchOffer";
import type { LaunchProviderOption } from "../../../common/launchOptions";
import type { ModelPreset } from "../../../common/modelPresets";

const MODEL: ModelPreset = {
  provider: "deepseek",
  id: "deepseek-chat",
  label: "deepseek-chat",
  contextLength: 0,
  pricePerMTok: { input: 0, output: 0 },
  trials: { status: "unmeasured" },
};

const provider = (over: Partial<LaunchProviderOption> = {}): LaunchProviderOption => ({
  id: "deepseek",
  label: "DeepSeek",
  ready: true,
  tokenEnv: "DEEPSEEK_API_KEY",
  models: [MODEL],
  ...over,
});

describe("what the launch picker offers", () => {
  it("offers a reachable provider that has a model to pick", () => {
    expect(isOfferable(provider())).toBe(true);
    expect(notOfferedReason(provider())).toBeNull();
  });

  // The bug in #1432: this rendered as a group header with no options under it, which a browser
  // draws as a row that neither a click nor an arrow key can reach.
  it("does not offer a reachable provider with no models", () => {
    expect(isOfferable(provider({ models: [] }))).toBe(false);
  });

  it("does not offer a provider this server cannot reach, however many models it lists", () => {
    expect(isOfferable(provider({ ready: false, reason: "needs DEEPSEEK_API_KEY" }))).toBe(false);
  });

  it("explains an unreachable provider in the server's own words", () => {
    expect(notOfferedReason(provider({ ready: false, reason: "provider 'deepseek' needs DEEPSEEK_API_KEY in the server's environment" }))).toBe(
      "provider 'deepseek' needs DEEPSEEK_API_KEY in the server's environment",
    );
  });

  // A `reason` is only promised when the server says why. Falling through to `undefined` here
  // would render an empty line in the help — worse than the bug it explains.
  it("still says something about an unreachable provider that carries no reason", () => {
    expect(notOfferedReason(provider({ ready: false }))).toContain("deepseek");
  });

  // The two halves a user cannot see from the picker: which file to edit, and that the measured
  // presets belong to one provider id.
  it("tells a models-less provider what to add and where", () => {
    const reason = notOfferedReason(provider({ models: [] })) ?? "";
    expect(reason).toContain("deepseek");
    expect(reason).toContain('"models"');
    expect(reason).toContain("~/.mulmoterminal/config.json");
    expect(reason).toContain("openrouter");
  });
});
