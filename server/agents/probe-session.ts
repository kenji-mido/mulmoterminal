// The session ids the rate-limit probe uses for its own throwaway Claude sessions (#1010).
//
// Recognisable by SHAPE rather than by a list this process keeps: the transcripts claude writes
// outlive the server that asked for them, so a remembered set stops recognising its own sessions
// the moment the process restarts and they surface in /api/sessions again (Codex review on #1019).
// A fixed prefix survives that, needs nothing persisted, and cannot drift out of sync with the
// files on disk.
//
// Still a syntactically valid v4-shaped UUID, because `--session-id` and SESSION_ID_RE both
// require one. Only the leading 12 hex digits are fixed; a real random UUID colliding with them is
// a 1-in-2^48 event, and the cost if it ever happened is one chat hidden from a listing.
//
// The mint and the match themselves now live in session/internal-session-id.ts, shared with the
// headless summarizer's ids: both build a file path out of the result and delete what they find
// there, so the anchored, hex-only match that makes that safe belongs in exactly one place.

import { isInternalSessionId, mintInternalSessionId } from "../session/internal-session-id.js";

export const PROBE_SESSION_PREFIX = "f0f0f0f0-1a7e-";

/** A fresh id for one probe session. */
export function newProbeSessionId(): string {
  return mintInternalSessionId(PROBE_SESSION_PREFIX);
}

/** Whether an id belongs to a probe — used to keep those sessions out of the listings, and to
 *  decide whether a transcript is ours to delete. */
export function isProbeSessionId(id: string): boolean {
  return isInternalSessionId(id, PROBE_SESSION_PREFIX);
}
