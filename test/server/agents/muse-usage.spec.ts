// What the muse badges are folded out of. Every record here is the shape a real session.jsonl
// holds (measured against muse's own log on 2026-08-06), because the whole risk in this file is
// reading a number that means something else.
import { describe, it, expect } from "vitest";
import { emptyMuseBadgeFold, foldMuseBadges, isMuseBadgeFold, copyMuseBadgeFold } from "../../../server/agents/muse-usage.js";

const completed = (usage: Record<string, number>, model = "muse-spark-1.2-contributor") => ({
  payload: { kind: "run", run_id: "r1", event: { kind: "model_completed", usage, model } },
});

const turn = (input: number, output: number, cached: number) => completed({ input_tokens: input, output_tokens: output, cached_tokens: cached });

describe("foldMuseBadges", () => {
  it("moves the cached part out of the fresh input rather than counting it twice", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, turn(1000, 50, 900));
    expect(fold.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheCreationTokens: 0 });
  });

  it("accepts the older cache_read_tokens spelling", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, completed({ input_tokens: 1000, output_tokens: 10, cache_read_tokens: 400 }));
    expect(fold.usage.cacheReadTokens).toBe(400);
    expect(fold.usage.inputTokens).toBe(600);
  });

  it("sums the usage across calls and names the most recent model", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, turn(1000, 50, 900));
    foldMuseBadges(fold, completed({ input_tokens: 2000, output_tokens: 20, cached_tokens: 1500 }, "muse-spark-9"));
    expect(fold.usage.outputTokens).toBe(70);
    expect(fold.usage.cacheReadTokens).toBe(2400);
    expect(fold.model).toBe("muse-spark-9");
  });

  // The context is the LAST call's, not the largest. `input_tokens` is the context that call ran
  // with, so a high-water mark never comes down after a compaction — on a real session that read
  // 397k against a live 266k, which is a badge telling the user to /compact when they need not.
  it("takes the context from the last completed call, not the biggest", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, turn(400_000, 10, 0));
    foldMuseBadges(fold, turn(266_000, 10, 0));
    expect(fold.contextTokens).toBe(266_000);
  });

  // The file's other run events embed whole context projections, whose numbers are not usage —
  // one of them carries a 6.8M "input" against a 1M-window model.
  it("ignores every record that is not a completed model call", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, { payload: { kind: "run", event: { kind: "context_projection_checkpoint", usage: { input_tokens: 6_800_000 } } } });
    foldMuseBadges(fold, { payload: { kind: "run", event: { kind: "model_completed" } } });
    foldMuseBadges(fold, { kind: "accepted" });
    expect(fold).toEqual(emptyMuseBadgeFold());
  });

  it("treats a negative or non-numeric count as nothing", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, completed({ input_tokens: -5, output_tokens: 10 } as unknown as Record<string, number>));
    expect(fold.usage.inputTokens).toBe(0);
    expect(fold.usage.outputTokens).toBe(10);
  });

  it("never counts more cache than input", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, turn(100, 0, 500));
    expect(fold.usage.cacheReadTokens).toBe(100);
    expect(fold.usage.inputTokens).toBe(0);
  });
});

describe("the sidecar contract", () => {
  it("recognises a value it wrote and rejects one it did not", () => {
    const fold = emptyMuseBadgeFold();
    foldMuseBadges(fold, turn(10, 1, 0));
    expect(isMuseBadgeFold(fold)).toBe(true);
    expect(isMuseBadgeFold({ ...fold, usage: undefined })).toBe(false);
    expect(isMuseBadgeFold({ ...fold, contextTokens: "many" })).toBe(false);
    expect(isMuseBadgeFold(null)).toBe(false);
  });

  // A shallow spread would hand out a value whose `usage` is still the cached one, and the next
  // fold would then mutate a total a caller is already holding.
  it("copies the usage rather than sharing it", () => {
    const fold = emptyMuseBadgeFold();
    const copy = copyMuseBadgeFold(fold);
    foldMuseBadges(copy, turn(10, 1, 0));
    expect(fold.usage.outputTokens).toBe(0);
  });
});
