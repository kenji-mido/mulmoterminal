// Session ids MulmoTerminal mints for its own machinery, recognisable later by their SHAPE.
//
// The rule they exist for: claude writes a transcript for every session it runs, including the
// ones nothing but this server asked for, and those files outlive the process that asked. So a
// set of "ids we started" stops recognising them the moment the server restarts, and they surface
// in /api/sessions as chats the user never had (Codex review on #1019). A fixed prefix survives a
// restart, needs nothing persisted, and cannot drift out of sync with the files on disk.
//
// The id stays a syntactically valid v4-shaped UUID because `--session-id` and SESSION_ID_RE both
// require one. Only the leading 12 hex digits are fixed; a real random UUID colliding with them is
// a 1-in-2^48 event, and the cost if it ever happened is one chat hidden from a listing.
//
// Its own module because the match is a security boundary as much as a filter (see below), and
// because it is not headless-specific: upstream shares this rule with the rate-limit probe's ids
// (#1010), and keeping one implementation is what stops the two from drifting.

import { randomBytes } from "node:crypto";

/** A full UUID and nothing else: anchored, hex-only, fixed groups.
 *
 *  Callers build a file path out of these ids (`<sessions-dir>/<id>.jsonl`) and delete what they
 *  find there, so "starts with the prefix" would accept `f0f0f0f0-1a7e-../../…` and resolve
 *  outside the directory — the guard that reads as protection would be granting it (Codex review
 *  on #1030). No separator or dot segment survives this. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh id under `prefix` (which must itself cover the first two UUID groups, e.g.
 *  "f0f0f0f0-1a7e-"). The version/variant digits are set so the result reads as a v4 UUID. */
export function mintInternalSessionId(prefix: string): string {
  const rest = randomBytes(8).toString("hex"); // 16 hex digits: 4 + 12
  return `${prefix}4${rest.slice(0, 3)}-8${rest.slice(3, 6)}-${rest.slice(4, 16)}`;
}

/** Whether `id` is one of ours under `prefix` — a whole well-formed UUID that starts with it.
 *  Case-insensitive on both sides, since an id can come back from a filename. */
export function isInternalSessionId(id: string, prefix: string): boolean {
  return UUID_RE.test(id) && id.toLowerCase().startsWith(prefix.toLowerCase());
}
