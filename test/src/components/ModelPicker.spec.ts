import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import ModelPicker from "../../../src/components/ModelPicker.vue";
import { reloadLaunchOptions } from "../../../src/composables/useLaunchOptions";

const MODELS = [
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    contextLength: 262_144,
    pricePerMTok: { input: 0.82, output: 3.75 },
    trials: { status: "measured" as const, passed: 3, of: 3, medianSeconds: 14, measuredAt: "2026-07-22" },
  },
  {
    provider: "openrouter",
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.2, output: 0.8 },
    trials: { status: "measured" as const, passed: 0, of: 4, medianSeconds: null, measuredAt: "2026-07-22" },
  },
];

const READY = { providers: [{ id: "openrouter", label: "OpenRouter", ready: true, tokenEnv: "OPENROUTER_API_KEY", models: MODELS }], anyReady: true };
const UNCONFIGURED = { providers: [], anyReady: false };
// Reachable — key present, base URL fine — and with nothing to run: the built-in presets are
// OpenRouter's alone, so any other id offers only what its own `models` lists (#1432).
const NO_MODELS = { providers: [{ id: "deepseek", label: "DeepSeek", ready: true, tokenEnv: "DEEPSEEK_API_KEY", models: [] }], anyReady: true };
const READY_AND_NO_MODELS = { providers: [...READY.providers, ...NO_MODELS.providers], anyReady: true };
const BLOCKED = {
  providers: [
    {
      id: "openrouter",
      label: "OpenRouter",
      ready: false,
      reason: "provider 'openrouter' needs OPENROUTER_API_KEY",
      tokenEnv: "OPENROUTER_API_KEY",
      models: MODELS,
    },
  ],
  anyReady: false,
};

const serve = async (payload: unknown) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
  await reloadLaunchOptions();
};

const picker = () => mount(ModelPicker, { props: { modelValue: null } });

beforeEach(() => vi.unstubAllGlobals());

describe("ModelPicker", () => {
  it("offers each reachable provider's models, defaulting to the directory's own choice", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const select = wrapper.get('[data-testid="cell-model-select"]');
    expect(select.findAll("optgroup").map((group) => group.attributes("label"))).toEqual(["OpenRouter"]);
    expect(select.findAll("option")[0].text()).toBe("This directory's default");
    expect(select.findAll("option")[0].attributes("value")).toBe("");
  });

  // The measurement has to survive the trip into the option text — a bare name would hide
  // the only thing that says whether the session will work.
  it("shows the pass rate next to each model", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.text()).toContain("Kimi K2.7 Code · 3/3 · 14s · 262k");
    expect(wrapper.text()).toContain("never used a tool");
  });

  it("sorts a model that never used a tool below one that always did", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const values = wrapper.findAll("option").map((option) => option.attributes("value"));
    expect(values.indexOf("openrouter|moonshotai/kimi-k2.7-code")).toBeLessThan(values.indexOf("openrouter|meta-llama/llama-4-maverick"));
  });

  it("emits the provider and model as a pair when one is picked", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    await wrapper.get('[data-testid="cell-model-select"]').setValue("openrouter|moonshotai/kimi-k2.7-code");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([{ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" }]);
  });

  // Null is what makes the server fall back to .mulmoterminal.json, so going back to the
  // default must clear the choice rather than emit an empty pair.
  it("emits null when the user returns to the directory's default", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    const select = wrapper.get('[data-testid="cell-model-select"]');
    await select.setValue("openrouter|moonshotai/kimi-k2.7-code");
    await select.setValue("");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([null]);
  });

  // #1432: a provider with no models rendered as `<optgroup label="DeepSeek"></optgroup>` — Chrome
  // draws that as a shaded row that a click and the arrow keys both skip, so it read as a broken
  // option rather than as the setup problem it is. Written against the SHAPE, not against this
  // payload: an empty group is never right, whatever put it there.
  it("never renders a group with no options in it", async () => {
    for (const payload of [READY, NO_MODELS, READY_AND_NO_MODELS]) {
      await serve(payload);
      const wrapper = picker();
      await flushPromises();
      const groups = wrapper.findAll("optgroup");
      expect(groups.every((group) => group.findAll("option").length > 0)).toBe(true);
      wrapper.unmount();
    }
  });

  it("does not offer a reachable provider that has no models to pick", async () => {
    await serve(READY_AND_NO_MODELS);
    const wrapper = picker();
    await flushPromises();
    expect(
      wrapper
        .get('[data-testid="cell-model-select"]')
        .findAll("optgroup")
        .map((group) => group.attributes("label")),
    ).toEqual(["OpenRouter"]);
  });

  // With nothing left to choose between, the select would be one row reading "This directory's
  // default" — a decision that isn't one. The setup problem is what to show instead.
  it("hides the select when the only provider has no models", async () => {
    await serve(NO_MODELS);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
  });

  // The help holds the explanation, so the link to it has to say that there IS one — otherwise a
  // grid where another provider works looks complete and the broken one is simply gone.
  it("points at the help when a configured provider is not offered", async () => {
    await serve(READY_AND_NO_MODELS);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.get('[data-testid="cell-model-help"]').text()).toBe("Needs attention");
  });

  it("says what to add for a provider with no models, and where", async () => {
    await serve(NO_MODELS);
    const wrapper = picker();
    await flushPromises();
    await wrapper.get('[data-testid="cell-model-help"]').trigger("click");
    expect(wrapper.text()).toContain("provider 'deepseek' has no models to pick");
    expect(wrapper.text()).toContain("~/.mulmoterminal/config.json");
  });

  it("keeps the plain help link when every configured provider is offered", async () => {
    await serve(READY);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.get('[data-testid="cell-model-help"]').text()).toBe("How this works");
  });

  it("hides the select when nothing is configured, and offers the help instead", async () => {
    await serve(UNCONFIGURED);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="cell-model-help"]').text()).toBe("Use another model…");
  });

  // A configured-but-unusable provider is the case where the user most needs the one
  // sentence naming what is missing — so it must not be offered as if it worked.
  it("does not offer a provider whose key is missing", async () => {
    await serve(BLOCKED);
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
  });

  it("puts that provider's own refusal at the top of the help", async () => {
    await serve(BLOCKED);
    const wrapper = picker();
    await flushPromises();
    await wrapper.get('[data-testid="cell-model-help"]').trigger("click");
    expect(wrapper.text()).toContain("provider 'openrouter' needs OPENROUTER_API_KEY");
  });

  // A picker that cannot load its list must not block launching: the form still starts a
  // session on whatever the directory already says.
  it("falls back to the directory default when the list cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await reloadLaunchOptions();
    const wrapper = picker();
    await flushPromises();
    expect(wrapper.find('[data-testid="cell-model-select"]').exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
