// Reading one record out of a codex rollout.
//
// Everything codex reports about a running session — the turn boundaries, the final reply, the
// token counts, the rate-limit windows — arrives as an `event_msg` whose real type is on the
// PAYLOAD, so every reader of a rollout starts by asking the same question. It was written out
// twice (the last-turn reader and the badge reader) before jscpd said so; a third copy is what
// this file exists to prevent.
import { isRecord } from "../../common/isRecord.js";

/**
 * The payload of an `event_msg` of this type, or null for any other record.
 *
 * BOTH halves are checked on purpose: the outer `type` is always `event_msg` and the inner one is
 * what distinguishes a `task_complete` from a `token_count`, so matching only the inner one would
 * also match a `response_item` that happens to carry the same field.
 */
export const codexEventPayload = (doc: Record<string, unknown>, type: string): Record<string, unknown> | null => {
  const payload = isRecord(doc.payload) ? doc.payload : null;
  return doc.type === "event_msg" && payload?.type === type ? payload : null;
};
