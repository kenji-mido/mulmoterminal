// Which sessions raised a notification the user was never actually told about.
//
// Two ways that happens, and neither leaves a trace on its own (#1152):
//   - the browser had not unlocked audio yet, so the beep was held rather than played
//   - the row was this session's FIRST since the page loaded, and a first row is baseline only
//     (notifyKind.ts) — so a session that was ALREADY waiting when the tab reloaded is asking
//     for the user with nothing having announced it
//
// Pure so the rules are unit-testable without a socket or an AudioContext; the reactive set
// lives in useMissedAttention.ts.

export type MissedMark = "mark" | "clear" | "none";

export interface MissedInput {
  /** The session's PTY was reaped — there is nothing left to go and look at. */
  closed: boolean;
  /** This row is the first seen for the session since the page loaded. */
  firstSighting: boolean;
  /** The session is asking for the user. */
  waiting: boolean;
  /** A notification WAS raised by this row, but could not be sounded. */
  suppressed: boolean;
}

/**
 * What this activity row does to the session's mark.
 *
 * `clear` on a row with no attention left is what makes the mark self-retiring: answering the
 * prompt (or viewing the cell, which drops the flag server-side) is the acknowledgement, so the
 * user never has to dismiss anything by hand.
 */
export function missedMarkFor(input: MissedInput): MissedMark {
  if (input.closed) return "clear";
  if (input.suppressed) return "mark";
  if (input.firstSighting && input.waiting) return "mark";
  return input.waiting ? "none" : "clear";
}
