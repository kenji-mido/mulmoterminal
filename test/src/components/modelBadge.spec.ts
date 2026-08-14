import { describe, it, expect } from "vitest";
import { modelBadge, shortModelLabel } from "../../../src/components/modelBadge";

const textFor = (model: string, contextTokens: number) => modelBadge("claude", model, contextTokens).text;

describe("shortModelLabel", () => {
  it("maps a Claude id to its family", () => {
    expect(shortModelLabel("claude-opus-4-20250514")).toBe("Opus");
    expect(shortModelLabel("claude-3-5-sonnet-20241022")).toBe("Sonnet");
    expect(shortModelLabel("claude-haiku-4-5-20251001")).toBe("Haiku");
    expect(shortModelLabel("claude-fable-5")).toBe("Fable");
  });

  it("falls back to the id's last path segment for a non-Claude model", () => {
    expect(shortModelLabel("gpt-5-codex")).toBe("gpt-5-codex");
    expect(shortModelLabel("openai/o3-pro")).toBe("o3-pro");
  });

  // agy names a model `Gemini 3.6 Flash (High)`. The badge does not truncate — it pushes the rest
  // of the header out — and the full name is still in the tip.
  it("drops a trailing bracketed qualifier", () => {
    expect(shortModelLabel("Gemini 3.6 Flash (High)")).toBe("Gemini 3.6 Flash");
    expect(modelBadge("antigravity", "Gemini 3.6 Flash (High)", 0).title).toContain("Gemini 3.6 Flash (High)");
  });

  it("keeps a name that is nothing but a bracketed part", () => {
    expect(shortModelLabel("(High)")).toBe("(High)");
  });

  it("prefers a preset's own label when the id is one we launch with", () => {
    expect(shortModelLabel("qwen/qwen3-235b-a22b-2507")).toBe("Qwen3 235B A22B");
  });
});

describe("modelBadge — the context window per model", () => {
  it("gives Opus 5 its 1M window (#985: it fell through to the 200k `opus` entry and read 290%)", () => {
    expect(textFor("claude-opus-5", 580_000)).toBe("Opus · ctx 58%");
  });

  it("does not let the `opus-5` entry claim Opus 4.5, which really is 200k", () => {
    expect(textFor("claude-opus-4-5-20251101", 100_000)).toBe("Opus · ctx 50%");
  });

  it("uses 1M for the rest of the current generation", () => {
    expect(textFor("claude-opus-4-6", 100_000)).toBe("Opus · ctx 10%");
    expect(textFor("claude-opus-4-7", 100_000)).toBe("Opus · ctx 10%");
    expect(textFor("claude-opus-4-8", 999_606)).toBe("Opus · ctx 100%");
    expect(textFor("claude-sonnet-4-6", 100_000)).toBe("Sonnet · ctx 10%");
    expect(textFor("claude-sonnet-5", 500_000)).toBe("Sonnet · ctx 50%");
    expect(textFor("claude-fable-5", 250_000)).toBe("Fable · ctx 25%");
    expect(textFor("claude-mythos-5", 250_000)).toBe("Mythos · ctx 25%");
  });

  it("keeps 200k for the older generations and for every Haiku", () => {
    expect(textFor("claude-opus-4-20250514", 70_000)).toBe("Opus · ctx 35%");
    expect(textFor("claude-sonnet-4-5-20250929", 100_000)).toBe("Sonnet · ctx 50%");
    expect(textFor("claude-haiku-4-5-20251001", 20_000)).toBe("Haiku · ctx 10%");
  });

  it("takes the window from a preset when the model is one of ours", () => {
    expect(textFor("qwen/qwen3-235b-a22b-2507", 131_072)).toBe("Qwen3 235B A22B · ctx 50%");
  });

  it("rounds the percentage", () => {
    expect(textFor("claude-opus-4", 51_234)).toBe("Opus · ctx 26%"); // 25.617%
  });
});

describe("modelBadge — what it shows when it cannot know", () => {
  it("shows no ctx at all for a model with no known window", () => {
    const badge = modelBadge("codex", "gpt-5-codex", 999_999);
    expect(badge.text).toBe("gpt-5-codex");
    expect(badge.title).toBe("Codex · gpt-5-codex · context 999,999 tokens");
  });

  it("shows `ctx ?` rather than an impossible percentage, and says so in the tooltip", () => {
    // The window is a hard cap, so past 100% the only thing the number reports is that our table
    // has the wrong window for this model — the exact shape #985 arrived in. Not clamped to 100%:
    // that would hide the gap instead of showing it.
    const badge = modelBadge("claude", "claude-opus-9", 580_000);
    expect(badge.text).toBe("Opus · ctx ?");
    expect(badge.title).toContain("580,000 tokens");
    expect(badge.title).toContain("200,000 window recorded for this model");
  });

  it("still reports a session sitting exactly at the window", () => {
    expect(textFor("claude-opus-4", 200_000)).toBe("Opus · ctx 100%");
  });

  it("tolerates a hair over the window, since the two token counts need not agree exactly", () => {
    expect(textFor("claude-opus-4", 200_800)).toBe("Opus · ctx 100%"); // 100.4% → 100%
    expect(textFor("claude-opus-4", 202_000)).toBe("Opus · ctx ?"); // 101%
  });
});

describe("modelBadge — the tooltip", () => {
  it("carries the agent, the full model id and the raw token counts", () => {
    expect(modelBadge("claude", "claude-opus-4-20250514", 70_000).title).toBe("Claude · claude-opus-4-20250514 · context 70,000 / 200,000 (35%) tokens");
  });
});

// #1465: the badge is no longer Claude-only, and the other agents do not all report the same
// things. codex states its window, grok and antigravity state nothing but a name.
describe("modelBadge — a window the agent reported", () => {
  it("prefers the agent's own window to the table", () => {
    // gpt-5.5 matches nothing in CONTEXT_WINDOWS, so without codex's number there is no percentage
    // to show at all.
    expect(modelBadge("codex", "gpt-5.5", 55_447).text).toBe("gpt-5.5");
    expect(modelBadge("codex", "gpt-5.5", 55_447, 258_400).text).toBe("gpt-5.5 · ctx 21%");
  });

  it("overrides a Claude family window rather than being overridden by it", () => {
    // A model whose window the table thinks it knows: whoever is RUNNING is the better authority,
    // which is the whole reason #985 could happen to a table nobody could correct from outside.
    expect(modelBadge("claude", "claude-opus-4", 100_000, 1_000_000).text).toBe("Opus · ctx 10%");
  });

  it("ignores a window that is absent, null or zero", () => {
    expect(modelBadge("claude", "claude-opus-4", 100_000, null).text).toBe("Opus · ctx 50%");
    expect(modelBadge("claude", "claude-opus-4", 100_000, 0).text).toBe("Opus · ctx 50%");
  });

  it("says only the model when nothing has counted any tokens", () => {
    // grok names its model and records no usage; `ctx 0%` would read as a measurement of an empty
    // context rather than the absence of one.
    expect(modelBadge("grok", "grok-4.5", 0).text).toBe("grok-4.5");
    expect(modelBadge("antigravity", "antigravity", 0).text).toBe("antigravity");
    expect(modelBadge("claude", "claude-opus-4", 0).text).toBe("Opus");
  });
});
