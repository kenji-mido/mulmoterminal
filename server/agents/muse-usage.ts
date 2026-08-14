// What a muse session log says about tokens — the two numbers behind `Muse · ctx 27%` and
// `⇡1.2M ⇣233k`.
//
// muse records both in ONE place: a `model_completed` event per completed model call in the
// session.jsonl the index points at, carrying that call's `usage`
// (`input_tokens`, `output_tokens`, `cached_tokens` / `cache_read_tokens`, `cache_write_tokens`).
//
// Two properties of that file decide the shape of everything here:
//
//   It is APPEND-ONLY and it is BIG — 33 MB after a day's work on this machine, with
//   `model_completed` about 1 line in 40. So it is folded through transcript-fold like grok's
//   updates.jsonl (#1377) rather than read whole: the first badge poll pays for the file, every
//   later one pays only for the turns since. Reading it whole per poll was the previous shape,
//   and at a poll per cell per minute that is tens of megabytes of JSON.parse a minute.
//
//   `input_tokens` is the CONTEXT of that call, not an increment. So the running total sums the
//   fresh part and `contextTokens` takes the LAST call's value rather than the largest: the
//   largest is a high-water mark that never comes down after a compaction, which on the session
//   measured here read 397k against a real 266k — a badge saying `/compact` is due when it is not.
import { isRecord } from "../../common/isRecord.js";
import type { SessionUsage } from "../session/transcript.js";
import { usageCount as num } from "./usage-count.js";

/** Everything one fold of a session log answers. One value rather than three folds, because all
 *  three come off the same record and folding the file three times costs three scans. */
export interface MuseBadgeFold {
  usage: SessionUsage;
  /** The model of the most recent completed call — what the session is running NOW, which is what
   *  `summary.json`'s `current_model_id` answers for grok. The index's `model_id` is the fallback,
   *  for a session that has not completed a call yet. */
  model: string | null;
  /** The context the last completed call ran with. */
  contextTokens: number;
}

export const emptyMuseBadgeFold = (): MuseBadgeFold => ({
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  model: null,
  contextTokens: 0,
});

export const copyMuseBadgeFold = (value: MuseBadgeFold): MuseBadgeFold => ({ ...value, usage: { ...value.usage } });

/** A sidecar is untrusted input, whoever wrote it (see transcript-fold.ts). */
export const isMuseBadgeFold = (value: unknown): value is MuseBadgeFold =>
  isRecord(value) &&
  isRecord(value.usage) &&
  typeof value.usage.inputTokens === "number" &&
  typeof value.usage.outputTokens === "number" &&
  typeof value.usage.cacheReadTokens === "number" &&
  typeof value.usage.cacheCreationTokens === "number" &&
  (value.model === null || typeof value.model === "string") &&
  typeof value.contextTokens === "number";

// `{ payload: { kind: "run", event: { kind: "model_completed", usage, model } } }`. Matched on the
// event's own kind rather than on `payload.kind`: the file carries other run events, and one of
// them (`context_projection_checkpoint`) embeds whole projections whose numbers are not usage at
// all — a match loose enough to admit it reads a 6.8M-token "context" off a 1M-window model.
function completedCall(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(record.payload)) return null;
  const event = record.payload.event;
  if (!isRecord(event) || event.kind !== "model_completed") return null;
  return event;
}

/**
 * Add one session-log record to a running total.
 *
 * `cached_tokens` is a SUBSET of `input_tokens` (measured: 265,265 of 265,515), so the cached part
 * is MOVED out of the fresh input rather than added beside it — same sum, and the badge's tooltip
 * gets a real cache breakdown. This is the arithmetic grok's fold already uses, kept identical so
 * two agents' badges mean the same thing.
 *
 * `cache_write_tokens` is left uncounted for grok's reason: it has been 0 in every call measured,
 * so whether it sits inside the input or beside it is unverified, and counting it could double
 * what the badge shows.
 */
export function foldMuseBadges(into: MuseBadgeFold, record: Record<string, unknown>): void {
  const event = completedCall(record);
  if (!event) return;
  const usage = isRecord(event.usage) ? event.usage : null;
  if (!usage) return;
  const input = num(usage, "input_tokens");
  // Two spellings, one number: newer muse writes `cached_tokens` and carries `cache_read_tokens`
  // beside it with the same value, older logs have only one of them.
  const cached = Math.min(num(usage, "cached_tokens") || num(usage, "cache_read_tokens"), input);
  into.usage.inputTokens += input - cached;
  into.usage.cacheReadTokens += cached;
  into.usage.outputTokens += num(usage, "output_tokens");
  into.contextTokens = input;
  if (typeof event.model === "string" && event.model.trim()) into.model = event.model;
}
