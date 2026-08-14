// @vitest-environment node
import { describe, it, expect } from "vitest";
import { emptyGrokUsage, foldGrokUsage, grokContextFromSignals, isGrokUsage } from "../../../server/agents/grok-usage.js";

// The two token readings a grok conversation writes down, parsed out of the real shapes grok
// 0.2.118 produces. Both samples below are trimmed copies of files from real conversations — the
// point of this spec is that they keep parsing, since nothing here can notice a format change on
// its own: a moved field reads as "this session has no numbers", silently.

const signals = JSON.stringify({
  turnCount: 1,
  compactionCount: 0,
  contextWindowUsage: 10,
  contextTokensUsed: 51_537,
  contextWindowTokens: 500_000,
  modelsUsed: ["grok-4.5"],
  primaryModelId: "grok-4.5",
});

const turnCompleted = (usage: Record<string, number>) =>
  JSON.parse(
    JSON.stringify({
      timestamp: 1_785_934_502,
      method: "_x.ai/session/update",
      params: { sessionId: "150496cf", update: { sessionUpdate: "turn_completed", stop_reason: "end_turn", usage } },
    }),
  ) as Record<string, unknown>;

const chunk = JSON.parse(
  JSON.stringify({
    method: "session/update",
    params: { sessionId: "150496cf", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } },
    _meta: { totalTokens: 9015 },
  }),
) as Record<string, unknown>;

describe("grokContextFromSignals", () => {
  it("reads the current context and the model's real window", () => {
    expect(grokContextFromSignals(signals)).toEqual({ model: "grok-4.5", contextTokens: 51_537, contextWindow: 500_000 });
  });

  // Nobody told us, rather than "no window": the client falls back to its own table on null, and a
  // zero would be a window of zero.
  it("answers nulls for a file it cannot use", () => {
    for (const text of ["", "not json", "[]", "{}"]) {
      expect(grokContextFromSignals(text)).toEqual({ model: null, contextTokens: 0, contextWindow: null });
    }
  });

  it("ignores a window of zero", () => {
    expect(grokContextFromSignals(JSON.stringify({ contextTokensUsed: 10, contextWindowTokens: 0 })).contextWindow).toBeNull();
  });
});

describe("foldGrokUsage", () => {
  it("sums the turns, because grok's usage is per-turn and not cumulative", () => {
    const total = emptyGrokUsage();
    // Real values from two consecutive turns of one conversation — the second is SMALLER, which is
    // what rules out reading the last record as a running total.
    foldGrokUsage(total, turnCompleted({ inputTokens: 109_728, outputTokens: 1436, totalTokens: 111_164, cachedReadTokens: 65_920, cacheCreationTokens: 0 }));
    foldGrokUsage(total, turnCompleted({ inputTokens: 98_548, outputTokens: 1388, totalTokens: 99_936, cachedReadTokens: 92_160, cacheCreationTokens: 0 }));
    expect(total).toEqual({
      // The cached part is MOVED out of the input, not added beside it: the badge adds its three
      // input fields together, so 109_728 + 98_548 is what it must come to.
      inputTokens: 109_728 - 65_920 + (98_548 - 92_160),
      cacheReadTokens: 65_920 + 92_160,
      outputTokens: 1436 + 1388,
      cacheCreationTokens: 0,
    });
    expect(total.inputTokens + total.cacheReadTokens).toBe(109_728 + 98_548);
  });

  it("skips everything that is not a completed turn", () => {
    const total = emptyGrokUsage();
    foldGrokUsage(total, chunk);
    foldGrokUsage(total, { params: { update: { sessionUpdate: "turn_completed" } } });
    foldGrokUsage(total, { hello: "world" });
    expect(total).toEqual(emptyGrokUsage());
  });

  // A count that is not a number, or negative, is not a count.
  it("ignores fields it cannot use", () => {
    const total = emptyGrokUsage();
    foldGrokUsage(total, turnCompleted({ inputTokens: 100, outputTokens: -5 } as unknown as Record<string, number>));
    foldGrokUsage(total, { params: { update: { sessionUpdate: "turn_completed", usage: { inputTokens: "lots" } } } });
    expect(total).toEqual({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  // A cached count larger than the input would otherwise make inputTokens negative, and the badge
  // would then show LESS than the turn's own input.
  it("never lets the cached part exceed the input it came out of", () => {
    const total = emptyGrokUsage();
    foldGrokUsage(total, turnCompleted({ inputTokens: 100, cachedReadTokens: 400, outputTokens: 1 }));
    expect(total.inputTokens).toBe(0);
    expect(total.cacheReadTokens).toBe(100);
  });
});

// The sidecar this fold is written to is untrusted input, whoever wrote it.
describe("isGrokUsage", () => {
  it("accepts a full usage and rejects a partial one", () => {
    expect(isGrokUsage(emptyGrokUsage())).toBe(true);
    expect(isGrokUsage({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 })).toBe(false);
    expect(isGrokUsage(null)).toBe(false);
  });
});
