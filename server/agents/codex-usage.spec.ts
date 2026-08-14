// @vitest-environment node
import { describe, it, expect } from "vitest";
import { codexBadgesFromRolloutDocs } from "./codex-usage";

// The records are real ones, trimmed: a `token_count` event and a `turn_context` as codex 0.146.0
// writes them. The numbers are what a live rollout on this machine held, which is where the
// arithmetic below was checked — `total_tokens` is `input_tokens` + `output_tokens`, so the cached
// and reasoning figures are SUBSETS and adding them again would overstate the session.
const tokenCount = (total: Record<string, number>, last: Record<string, number>, window: number) => ({
  timestamp: "2026-08-04T05:25:36.182Z",
  type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: window } },
});

const turnContext = (model: string) => ({ timestamp: "2026-08-04T05:24:19.315Z", type: "turn_context", payload: { turn_id: "t1", model } });

const usage = {
  input_tokens: 108_611,
  cached_input_tokens: 21_248,
  cache_write_input_tokens: 0,
  output_tokens: 6481,
  reasoning_output_tokens: 1105,
  total_tokens: 115_092,
};
const lastTurn = {
  input_tokens: 55_447,
  cached_input_tokens: 16_768,
  cache_write_input_tokens: 0,
  output_tokens: 3215,
  reasoning_output_tokens: 125,
  total_tokens: 58_662,
};

describe("codexBadgesFromRolloutDocs", () => {
  it("reads the session totals, the current context and the model's own window", () => {
    const badges = codexBadgesFromRolloutDocs([turnContext("gpt-5.5"), tokenCount(usage, lastTurn, 258_400)]);
    expect(badges.usage).toEqual({ inputTokens: 108_611, outputTokens: 6481, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(badges.context).toEqual({ model: "gpt-5.5", contextTokens: 55_447, contextWindow: 258_400 });
  });

  // The cached figure is inside `input_tokens`. Splitting it into `cacheReadTokens` would have the
  // UI — which sums input + cacheRead + cacheCreation for the ⇡ badge — count it twice, reporting
  // 129,859 input tokens for a session codex says used 108,611.
  it("does not double-count the cached input", () => {
    const { usage: shown } = codexBadgesFromRolloutDocs([tokenCount(usage, lastTurn, 258_400)]);
    expect(shown.inputTokens + shown.cacheReadTokens + shown.cacheCreationTokens).toBe(usage.input_tokens);
  });

  it("takes the LAST of each, so /model mid-session and the newest turn win", () => {
    const badges = codexBadgesFromRolloutDocs([
      turnContext("gpt-5.5"),
      tokenCount(usage, lastTurn, 258_400),
      turnContext("gpt-5.5-codex-mini"),
      tokenCount({ ...usage, input_tokens: 200_000 }, { ...lastTurn, input_tokens: 90_000 }, 400_000),
    ]);
    expect(badges.context).toEqual({ model: "gpt-5.5-codex-mini", contextTokens: 90_000, contextWindow: 400_000 });
    expect(badges.usage.inputTokens).toBe(200_000);
  });

  // An interrupted turn writes the event with no `info`. Skipped rather than treated as zeroes,
  // or the badge would blank out every time a turn was cancelled.
  it("keeps the last real reading when a later event carries no info", () => {
    const badges = codexBadgesFromRolloutDocs([
      turnContext("gpt-5.5"),
      tokenCount(usage, lastTurn, 258_400),
      { type: "event_msg", payload: { type: "token_count", info: null } },
    ]);
    expect(badges.usage.inputTokens).toBe(108_611);
    expect(badges.context.contextTokens).toBe(55_447);
  });

  it("answers nulls and zeroes for a rollout that has not counted anything yet", () => {
    const badges = codexBadgesFromRolloutDocs([{ type: "session_meta", payload: { id: "019fcb3a-a33c-7e72-8364-57e44926dfed" } }]);
    expect(badges.context).toEqual({ model: null, contextTokens: 0, contextWindow: null });
    expect(badges.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});
