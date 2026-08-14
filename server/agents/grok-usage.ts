// What a grok conversation says about tokens — the two numbers behind `Grok · ctx 33%` and
// `⇡1.2M ⇣18k` (#1465 shipped the model alone; this is the rest).
//
// #1465's reading was that a conversation directory holds no token accounting. That was measured
// against `summary.json` and `events.jsonl`, and both really are silent. The accounting is in the
// two files it did not open, and grok 0.2.118 writes both for every conversation:
//
//   signals.json    the CURRENT context, rewritten whole each turn. `contextTokensUsed`,
//                   `contextWindowTokens` and the model it has mostly run under. This is grok's
//                   own arithmetic — the same number its `/status` shows — so the badge does not
//                   have to infer a window from a substring table, which has been wrong (#985).
//   updates.jsonl   one `turn_completed` record per turn, carrying that turn's `usage`
//                   (`inputTokens`, `outputTokens`, `cachedReadTokens`, `cacheCreationTokens`).
//
// PER TURN, not cumulative — measured over a 16-turn conversation where the values rise and fall
// (74k, 109k, 98k, 192k …). So the session total is the SUM, which means the whole file, which is
// why the caller folds it through transcript-fold rather than reading a tail: every byte counts
// exactly once, and a later poll pays only for the turns that arrived since.
import { isRecord } from "../../common/isRecord.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import type { SessionUsage } from "../session/transcript.js";
import { usageCount as num } from "./usage-count.js";

export const emptyGrokUsage = (): SessionUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });

export const isGrokUsage = (value: unknown): value is SessionUsage =>
  isRecord(value) &&
  typeof value.inputTokens === "number" &&
  typeof value.outputTokens === "number" &&
  typeof value.cacheReadTokens === "number" &&
  typeof value.cacheCreationTokens === "number";

/**
 * The context reading in a conversation's `signals.json`, or nulls/zeroes when it says nothing.
 *
 * `contextTokensUsed` is what will be re-sent for the next turn — the same thing Claude's
 * `contextTokens` means, and it cross-checks exactly against the running `_meta.totalTokens` grok
 * stamps on the last update it wrote. `contextWindowTokens` is the model's real window (500,000
 * for grok-4.5), stated by the agent, so it travels on `contextWindow` and the client's table is
 * never consulted.
 *
 * The model here is `primaryModelId` — the one this conversation has MOSTLY run under, which is
 * not the same question `summary.json`'s `current_model_id` answers after a `/model`. It is a
 * fallback only, for a conversation whose summary has not been written yet.
 */
export function grokContextFromSignals(text: string): SessionContextInfo {
  const doc = parseRecord(text);
  if (!doc) return { model: null, contextTokens: 0, contextWindow: null };
  const window = num(doc, "contextWindowTokens");
  return {
    model: typeof doc.primaryModelId === "string" && doc.primaryModelId.trim() ? doc.primaryModelId : null,
    contextTokens: num(doc, "contextTokensUsed"),
    contextWindow: window > 0 ? window : null,
  };
}

/**
 * Add one `updates.jsonl` record to a running total. Anything that is not a completed turn — the
 * message and tool chunks, which are ~99% of the file — is skipped.
 *
 * grok's own arithmetic is kept: `totalTokens` = `inputTokens` + `outputTokens`, with
 * `cachedReadTokens` a SUBSET of the input. The badge adds its three input fields together, so the
 * cached part is MOVED out of `inputTokens` rather than added beside it — same sum, and the
 * tooltip gets a real cache breakdown. `cacheCreationTokens` is left uncounted: it has been 0 in
 * every turn measured, and whether it sits inside the input or beside it is therefore unverified —
 * counting it could double what the badge shows.
 */
export function foldGrokUsage(into: SessionUsage, record: Record<string, unknown>): void {
  const usage = turnUsage(record);
  if (!usage) return;
  const input = num(usage, "inputTokens");
  const cached = Math.min(num(usage, "cachedReadTokens"), input);
  into.inputTokens += input - cached;
  into.cacheReadTokens += cached;
  into.outputTokens += num(usage, "outputTokens");
}

// `{ method: "…/session/update", params: { update: { sessionUpdate: "turn_completed", usage } } }`.
// The method name carries a private prefix on this record (`_x.ai/session/update`) where the
// streaming ones do not, so it is the `sessionUpdate` discriminator that is matched, not the method.
function turnUsage(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(record.params)) return null;
  const update = record.params.update;
  if (!isRecord(update) || update.sessionUpdate !== "turn_completed") return null;
  return isRecord(update.usage) ? update.usage : null;
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
