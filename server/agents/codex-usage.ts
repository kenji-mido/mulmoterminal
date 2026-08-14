// What a codex rollout says about tokens and the model, for the two header badges Claude
// sessions have always had (#1465). Pure: fed records, answers the same two objects the Claude
// transcript reader answers with, so the route needs no branch beyond picking the reader.
//
// codex accounts for itself in `event_msg` / `token_count` events, one per turn:
//
//   info.total_token_usage    cumulative for the session  -> the ⇡/⇣ badge
//   info.last_token_usage     the most recent turn        -> how full the context is
//   info.model_context_window the model's window          -> the % the badge shows
//
// The window is why this reads better than Claude's: codex STATES it, where the Claude path
// infers it from a substring table that has been wrong (#985). It travels on `contextWindow`.
//
// The model is not in that event — it is on `turn_context`, written at the start of each turn,
// and the LAST one wins because `/model` mid-session changes it.
//
// **Cumulative, so the tail is enough.** Every field here is either a running total or a
// most-recent value, so a reader that sees only the end of the file gets the same answer as one
// that folded the whole thing. That is what lets the caller use readTailRecords on a rollout of
// any size.
import { isRecord } from "../../common/isRecord.js";
import { codexEventPayload } from "./codex-events.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import type { SessionUsage } from "../session/transcript.js";

export interface CodexBadges {
  usage: SessionUsage;
  context: SessionContextInfo;
}

export const EMPTY_CODEX_BADGES: CodexBadges = {
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  context: { model: null, contextTokens: 0, contextWindow: null },
};

const num = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const positive = (record: Record<string, unknown>, key: string): number | null => {
  const value = num(record, key);
  return value > 0 ? value : null;
};

const bucket = (info: Record<string, unknown>, key: string): Record<string, unknown> | null => (isRecord(info[key]) ? info[key] : null);

// codex's own arithmetic, kept rather than reshaped: `total_tokens` = `input_tokens` +
// `output_tokens`, with `cached_input_tokens` a SUBSET of the input and
// `reasoning_output_tokens` a subset of the output. Splitting the cached part out into
// `cacheReadTokens` would double-count it — the UI adds the three input fields together — so the
// whole input goes in `inputTokens` and the cache buckets stay 0. The badge shows the two sums,
// which is exactly what codex reports; what is lost is a breakdown nothing renders.
const usageFrom = (totals: Record<string, unknown>): SessionUsage => ({
  inputTokens: num(totals, "input_tokens"),
  outputTokens: num(totals, "output_tokens"),
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

/** The model a `turn_context` names, or null for any other record. Written at the start of every
 *  turn, so the last one seen is what the session is running now — `/model` changes it. */
function turnContextModel(doc: Record<string, unknown>): string | null {
  if (doc.type !== "turn_context" || !isRecord(doc.payload)) return null;
  const model = doc.payload.model;
  return typeof model === "string" && model ? model : null;
}

/**
 * The last model named in these records, with none of the token reading.
 *
 * For the ONE thing in this file that is not cumulative. Every other field is a running total or
 * a most-recent value, so the tail answers as well as the whole file — but `turn_context` is
 * written once, at the START of a turn, and a turn that then writes more than the tail window
 * leaves its own model row outside it. The reader would pair fresh token numbers with `model:
 * null`, and the badge hides on exactly the long sessions the bounded read exists to serve.
 *
 * So the caller reads the rollout's HEAD with this when the tail named nobody: the first
 * `turn_context` of the session is a few hundred bytes in. That answers "which model" for every
 * session that has not used `/model`, at 64 KB rather than an unbounded scan.
 */
export function codexModelFromDocs(docs: Record<string, unknown>[]): string | null {
  let model: string | null = null;
  for (const doc of docs) model = turnContextModel(doc) ?? model;
  return model;
}

export function codexBadgesFromRolloutDocs(docs: Record<string, unknown>[]): CodexBadges {
  let usage = EMPTY_CODEX_BADGES.usage;
  let contextTokens = 0;
  let contextWindow: number | null = null;
  let model: string | null = null;

  for (const doc of docs) {
    model = turnContextModel(doc) ?? model;

    const counted = codexEventPayload(doc, "token_count");
    const info = counted && isRecord(counted.info) ? counted.info : null;
    if (!info) continue; // codex emits a token_count with `info: null` when a turn was interrupted
    const totals = bucket(info, "total_token_usage");
    if (totals) usage = usageFrom(totals);
    const last = bucket(info, "last_token_usage");
    // The tokens re-sent as context for the next turn — the turn's INPUT, matching what the Claude
    // reader counts (fresh input plus cache). The turn's output is excluded there and here.
    if (last) contextTokens = num(last, "input_tokens");
    contextWindow = positive(info, "model_context_window") ?? contextWindow;
  }

  return { usage, context: { model, contextTokens, contextWindow } };
}
