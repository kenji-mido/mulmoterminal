// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

import { launchOptions } from "../../../server/config/launch-options.js";
import { resolveProvider, type ProviderConfig } from "../../../server/session/provider-env.js";
import { sanitizeProviders } from "../../../server/config/app-config.js";
import { launchChoiceFromParams } from "../../../server/session/launch-choice.js";

const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api",
  tokenEnv: "OPENROUTER_API_KEY",
};

const WITH_KEY = { OPENROUTER_API_KEY: "sk-test" } as NodeJS.ProcessEnv;

describe("launchOptions", () => {
  it("offers nothing when no provider is configured", () => {
    expect(launchOptions([], WITH_KEY)).toEqual({ providers: [], anyReady: false });
  });

  it("marks a provider ready when its token is in the environment", () => {
    const { providers, anyReady } = launchOptions([OPENROUTER], WITH_KEY);
    expect(anyReady).toBe(true);
    expect(providers[0]).toMatchObject({ id: "openrouter", label: "OpenRouter", ready: true });
    expect(providers[0].reason).toBeUndefined();
  });

  it("lists the built-in presets for that provider", () => {
    const [option] = launchOptions([OPENROUTER], WITH_KEY).providers;
    expect(option.models.length).toBeGreaterThan(10);
    expect(option.models.map((model) => model.id)).toContain("moonshotai/kimi-k2.7-code");
    expect(option.models.every((model) => model.provider === "openrouter")).toBe(true);
  });

  it("appends the user's own models, marked as never measured", () => {
    const [option] = launchOptions([{ ...OPENROUTER, models: ["acme/experimental-1"] }], WITH_KEY).providers;
    const added = option.models.find((model) => model.id === "acme/experimental-1");
    expect(added?.trials.status).toBe("unmeasured");
  });

  // A model the user lists that we already measured must not appear twice — and must keep
  // the measurement rather than being downgraded to "unmeasured" by the duplicate.
  it("does not duplicate a user model that is already a preset", () => {
    const [option] = launchOptions([{ ...OPENROUTER, models: ["moonshotai/kimi-k2.7-code"] }], WITH_KEY).providers;
    const matches = option.models.filter((model) => model.id === "moonshotai/kimi-k2.7-code");
    expect(matches).toHaveLength(1);
    expect(matches[0].trials.status).toBe("measured");
  });

  // The dedup has to agree with `presetFor`, which matches ids case-insensitively. A user
  // who lists the preset in different case must still get the measured preset once, not a
  // second "unmeasured" row for the same model.
  it("dedups a user model that matches a preset only by case", () => {
    const [option] = launchOptions([{ ...OPENROUTER, models: ["MoonshotAI/Kimi-K2.7-Code"] }], WITH_KEY).providers;
    const matches = option.models.filter((model) => model.id.toLowerCase() === "moonshotai/kimi-k2.7-code");
    expect(matches).toHaveLength(1);
    expect(matches[0].trials.status).toBe("measured");
  });

  it("still lists a provider whose token is missing, and says so", () => {
    const { providers, anyReady } = launchOptions([OPENROUTER], {} as NodeJS.ProcessEnv);
    expect(anyReady).toBe(false);
    expect(providers[0].ready).toBe(false);
    expect(providers[0].reason).toContain("OPENROUTER_API_KEY");
  });

  it("reports an unusable baseUrl instead of offering a backend that would 404", () => {
    const [option] = launchOptions([{ ...OPENROUTER, baseUrl: "https://openrouter.ai/api/v1" }], WITH_KEY).providers;
    expect(option.ready).toBe(false);
    expect(option.reason).toContain("/v1");
  });

  // The picker's explanation and the session's refusal have to be the same sentence — a UI
  // that says one thing while the spawn says another is how a user ends up debugging the
  // wrong half of their setup.
  it("explains a refusal in the same words the spawn would refuse with", () => {
    const [option] = launchOptions([OPENROUTER], {} as NodeJS.ProcessEnv).providers;
    const spawn = resolveProvider({ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" }, [OPENROUTER], {} as NodeJS.ProcessEnv);
    expect(spawn.ok).toBe(false);
    expect(option.reason).toBe(spawn.ok ? undefined : spawn.reason);
  });

  it("never exposes the token itself, only the variable's name", () => {
    const serialized = JSON.stringify(launchOptions([OPENROUTER], WITH_KEY));
    expect(serialized).toContain("OPENROUTER_API_KEY");
    expect(serialized).not.toContain("sk-test");
  });

  it("is ready when any one of several providers is", () => {
    const broken = { ...OPENROUTER, id: "moonshot", label: "Moonshot", tokenEnv: "MOONSHOT_API_KEY" };
    expect(launchOptions([broken, OPENROUTER], WITH_KEY).anyReady).toBe(true);
  });

  // The rule that made #1432 reachable: every preset in modelPresets.ts carries
  // `provider: "openrouter"`, so a backend registered under any other id starts with nothing and
  // offers only what its own `models` lists. Pinned because it is invisible from the config file,
  // and because "register it and the models appear" was written down as advice.
  it("gives a provider whose id is not openrouter no presets of its own", () => {
    const deepseek: ProviderConfig = { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", tokenEnv: "DEEPSEEK_API_KEY" };
    const [option] = launchOptions([deepseek], { DEEPSEEK_API_KEY: "sk-test" } as NodeJS.ProcessEnv).providers;
    expect(option).toMatchObject({ id: "deepseek", ready: true, models: [] });
  });

  it("offers exactly the models such a provider lists, and nothing else", () => {
    const deepseek: ProviderConfig = {
      id: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      tokenEnv: "DEEPSEEK_API_KEY",
      models: ["deepseek-chat", "deepseek-reasoner"],
    };
    const [option] = launchOptions([deepseek], { DEEPSEEK_API_KEY: "sk-test" } as NodeJS.ProcessEnv).providers;
    expect(option.models.map((model) => model.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(option.models.every((model) => model.provider === "deepseek" && model.trials.status === "unmeasured")).toBe(true);
  });
});

// Codex on PR #587: the config schema accepted ids the launch parser then dropped, and a
// dropped provider whose model survived would have started the session on Anthropic. The
// two now share one id shape — this pins them together rather than trusting they agree.
describe("what config accepts and what the launch path accepts", () => {
  const provider = (id: string) => ({ id, label: "X", baseUrl: "https://x.example/api", tokenEnv: "X_KEY" });

  it("keeps a provider whose id the launch parser would also accept", () => {
    expect(sanitizeProviders([provider("open-router.v2")]).map((p) => p.id)).toEqual(["open-router.v2"]);
  });

  // The last case is #1503's asymmetry: `[1m]` names a context window, which a MODEL has and a
  // provider key does not, so the two shapes deliberately disagree on exactly that one suffix.
  it.each(["has space", "-leading-dash", "pipe|char", "", "openrouter[1m]"])("refuses the id %j that the launch parser would drop", (id) => {
    expect(sanitizeProviders([provider(id)])).toEqual([]);
  });

  it("drops only the malformed model, not the provider's whole list", () => {
    const [saved] = sanitizeProviders([{ ...provider("openrouter"), models: ["z-ai/glm-5.2", "bad id", 42] }]);
    expect(saved.models).toEqual(["z-ai/glm-5.2"]);
  });

  // #1503 named three surfaces, and this is the third: `.mulmoterminal.json`'s `model`, the
  // picker, and a provider's own `models` list all read one shape. A suffix refused HERE is
  // near-silent — the picker just shows a backend with fewer models than the file lists (#1432)
  // — so it needs its own assertion rather than trusting the shared predicate.
  //
  // `sonnet[1m]` is the realistic entry: behind a gateway that is exactly how the docs say to
  // select Sonnet 5's 1M window.
  it("keeps a model carrying the [1m] extended-context suffix", () => {
    const [saved] = sanitizeProviders([{ ...provider("gateway"), models: ["~anthropic/claude-opus-latest[1m]", "sonnet[1m]"] }]);
    expect(saved.models).toEqual(["~anthropic/claude-opus-latest[1m]", "sonnet[1m]"]);
  });

  // Dropping them silently is half of #1432: the picker then says the backend has no models
  // while the user is looking at a config file that lists them. Each case uses its own provider
  // id — the warning is said once per process, so a repeat of the same sentence stays quiet.
  describe("and what it says when it drops one", () => {
    const warn = () => vi.spyOn(console, "warn").mockImplementation(() => {});
    afterEach(() => vi.restoreAllMocks());

    it("names every model id it refused, and the shape it wanted", () => {
      const spy = warn();
      sanitizeProviders([{ ...provider("named-drops"), models: ["z-ai/glm-5.2", "bad id", 42] }]);
      const line = spy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(line).toContain("named-drops");
      expect(line).toContain('"bad id"');
      expect(line).toContain("42");
      expect(line).not.toContain("z-ai/glm-5.2");
    });

    it("says so when `models` is not a list at all, which empties it whole", () => {
      const spy = warn();
      const [saved] = sanitizeProviders([{ ...provider("not-a-list"), models: { "deepseek-chat": true } }]);
      expect(saved.models).toEqual([]);
      expect(spy.mock.calls.map((call) => String(call[0])).join("\n")).toContain("not-a-list");
    });

    // The value is whatever the user's JSON held, and "longer than a model id may be" is one of
    // the reasons it was rejected — so the line quotes it to a bound instead of echoing a
    // megabyte of it. Observed during review; no bot flagged it.
    it("quotes a rejected value to a bound rather than echoing it whole", () => {
      const spy = warn();
      const huge = `x`.repeat(50_000);
      sanitizeProviders([{ ...provider("huge-value"), models: [`${huge} not an id`] }]);
      const line = spy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(line).toContain("huge-value");
      expect(line.length).toBeLessThan(400);
    });

    it("stays quiet when every listed model was kept", () => {
      const spy = warn();
      sanitizeProviders([{ ...provider("all-kept"), models: ["z-ai/glm-5.2", " moonshotai/kimi-k3 "] }]);
      expect(spy).not.toHaveBeenCalled();
    });

    it("stays quiet when the entry lists no models at all", () => {
      const spy = warn();
      sanitizeProviders([provider("no-models-listed")]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // The round trip that matters: anything config keeps must survive the ws query.
  it("round-trips every id config keeps through the launch parser", () => {
    for (const { id } of sanitizeProviders([provider("openrouter"), provider("moonshot"), provider("gw.internal:8080")])) {
      expect(launchChoiceFromParams(new URLSearchParams({ provider: id, model: "m" }))).toEqual({ provider: id, model: "m" });
    }
  });
});
