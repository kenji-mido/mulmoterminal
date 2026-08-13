// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { projectSessionsDir } from "../../../server/session/project-dir.js";
import { rateForModel, costForUsage, costFromJsonl } from "../../../server/session/cost.js";

const line = (o: unknown) => JSON.stringify(o);
const assistant = (model: string, usage: Record<string, number>) => line({ type: "assistant", message: { model, usage } });

describe("rateForModel", () => {
  it("prices current Opus / Sonnet / Haiku models", () => {
    expect(rateForModel("claude-opus-4-8")).toEqual({
      inputPerMillion_usd: 5,
      outputPerMillion_usd: 25,
      cacheReadPerMillion_usd: 0.5,
      cacheWritePerMillion_usd: 6.25,
    });
    expect(rateForModel("claude-sonnet-5")?.inputPerMillion_usd).toBe(3);
    expect(rateForModel("claude-haiku-4-5")?.outputPerMillion_usd).toBe(5);
    expect(rateForModel("claude-fable-5")?.inputPerMillion_usd).toBe(10);
  });

  it("matches dated snapshots by family prefix", () => {
    expect(rateForModel("claude-sonnet-4-5-20250929")?.inputPerMillion_usd).toBe(3);
    expect(rateForModel("claude-opus-4-5-20251101")?.outputPerMillion_usd).toBe(25);
  });

  it("does not confuse sonnet-5 with sonnet-4-5", () => {
    expect(rateForModel("claude-sonnet-5")?.outputPerMillion_usd).toBe(15);
    expect(rateForModel("claude-sonnet-4-5")?.outputPerMillion_usd).toBe(15);
  });

  it("returns null for unknown / empty models", () => {
    expect(rateForModel("gpt-4o")).toBeNull();
    expect(rateForModel("claude-opus-4-0")).toBeNull(); // not in the table → unpriced
    expect(rateForModel("")).toBeNull();
  });
});

describe("costForUsage", () => {
  it("prices input, output, cache-read and cache-write separately", () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    };
    const { usd, priced } = costForUsage(usage, "claude-opus-4-8");
    // 5 + 25 + 0.5 + 6.25
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(36.75, 10);
  });

  it("charges cache reads at 0.1x and writes at 1.25x the input rate", () => {
    const read = costForUsage({ cache_read_input_tokens: 1_000_000 }, "claude-sonnet-5").usd;
    const write = costForUsage({ cache_creation_input_tokens: 1_000_000 }, "claude-sonnet-5").usd;
    expect(read).toBeCloseTo(0.3, 10); // 3 * 0.1
    expect(write).toBeCloseTo(3.75, 10); // 3 * 1.25
  });

  it("is unpriced (usd 0) for an unknown model", () => {
    expect(costForUsage({ input_tokens: 1_000_000 }, "some-other-model")).toEqual({ usd: 0, priced: false });
  });

  it("treats missing / negative / non-number token fields as zero", () => {
    expect(costForUsage({}, "claude-opus-4-8").usd).toBe(0);
    expect(costForUsage({ input_tokens: -50, output_tokens: "10" }, "claude-opus-4-8").usd).toBe(0);
  });
});

describe("costFromJsonl", () => {
  it("sums cost across assistant turns, per turn's own model (model switch)", () => {
    const raw = [
      assistant("claude-opus-4-8", { output_tokens: 1_000_000 }), // $25
      line({ type: "user", message: { content: "hi" } }),
      assistant("claude-sonnet-5", { output_tokens: 1_000_000 }), // $15
    ].join("\n");
    const { usd, unpricedTurns } = costFromJsonl(raw);
    expect(usd).toBeCloseTo(40, 10);
    expect(unpricedTurns).toBe(0);
  });

  it("counts turns on unpriced models and excludes them from the total", () => {
    const raw = [
      assistant("claude-opus-4-8", { output_tokens: 1_000_000 }), // $25
      assistant("mystery-model", { output_tokens: 1_000_000 }), // unpriced
    ].join("\n");
    const { usd, unpricedTurns } = costFromJsonl(raw);
    expect(usd).toBeCloseTo(25, 10);
    expect(unpricedTurns).toBe(1);
  });

  it("treats an assistant turn missing its model as unpriced", () => {
    const raw = line({ type: "assistant", message: { usage: { output_tokens: 1_000_000 } } });
    expect(costFromJsonl(raw)).toEqual({ usd: 0, unpricedTurns: 1 });
  });

  it("ignores non-assistant lines and assistant lines without usage", () => {
    const raw = [
      line({ type: "user", message: { content: "hi" } }),
      line({ type: "assistant", message: { model: "claude-opus-4-8" } }), // no usage → skipped
    ].join("\n");
    expect(costFromJsonl(raw)).toEqual({ usd: 0, unpricedTurns: 0 });
  });

  it("returns zeros for empty or malformed input", () => {
    expect(costFromJsonl("")).toEqual({ usd: 0, unpricedTurns: 0 });
    expect(costFromJsonl("not json\n{broken")).toEqual({ usd: 0, unpricedTurns: 0 });
  });
});

// /api/cost read every one of a project's transcripts in full, on every request and with no cache
// at all — 2.5-3.1 s on a 1.1 GB project, every time the cost panel was opened (#1386). It now
// folds each file once and resumes on what was appended, so what is pinned here is that a resumed
// total is the same total.
describe("a transcript's cost, folded across reads", () => {
  let scratch: ScratchHome;
  let n = 0;
  const CWD = "/Users/me/proj";

  // projectSessionsDir, not a second copy of its rule — it resolves the cwd for the host platform,
  // so the encoded directory differs on Windows (#1396).
  const transcriptPath = (id: string): string => {
    const dir = projectSessionsDir(CWD);
    mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}.jsonl`);
  };

  const priced = (outputTokens: number) => `${assistant("claude-sonnet-5", { input_tokens: 0, output_tokens: outputTokens })}\n`;
  const unpriced = () => `${assistant("some-unknown-model", { input_tokens: 10, output_tokens: 10 })}\n`;

  async function freshCost() {
    vi.resetModules(); // the scratch home is already in place; the module reads it at import
    const mod = await import("../../../server/session/cost.js");
    return mod.sessionCost;
  }

  beforeEach(() => {
    scratch = takeScratchHome("mt-cost-fold-");
  });
  afterEach(() => scratch.release());

  it("adds what was appended to the total it already had", async () => {
    const sessionCost = await freshCost();
    const id = `sess-${++n}`;
    writeFileSync(transcriptPath(id), priced(1_000_000) + unpriced());
    const first = await sessionCost(CWD, id);
    expect(first.usd).toBeGreaterThan(0);
    expect(first.unpricedTurns).toBe(1);

    appendFileSync(transcriptPath(id), priced(1_000_000));
    const grown = await sessionCost(CWD, id);
    expect(grown.usd).toBeCloseTo(first.usd * 2, 10);
    expect(grown.unpricedTurns).toBe(1);
  });

  // The equivalence: a total built in two goes is the total one pass would produce.
  it("matches a reader that folded the grown file in one pass", async () => {
    const id = `sess-${++n}`;
    const sessionCost = await freshCost();
    writeFileSync(transcriptPath(id), priced(500_000));
    await sessionCost(CWD, id);
    appendFileSync(transcriptPath(id), priced(250_000) + unpriced());
    const resumed = await sessionCost(CWD, id);

    const oneShot = await (await freshCost())(CWD, id);
    expect(resumed).toEqual(oneShot);
  });

  it("costs nothing for a transcript that is not there", async () => {
    const sessionCost = await freshCost();
    expect(await sessionCost(CWD, "never-existed")).toEqual({ usd: 0, unpricedTurns: 0 });
  });
});
