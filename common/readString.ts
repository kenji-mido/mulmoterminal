// Reading a string out of untrusted JSON — a phone's command params, a transcript line, a `gh`
// response — without `String()`.
//
// `String(value)` answers for ANY input, and that is the problem: an object becomes the literal
// text "[object Object]" and an array becomes "1,2". Nothing throws, so the bad value travels —
// as a collection slug that matches nothing, or as a session title on screen. The rule that
// catches this is @typescript-eslint/no-base-to-string.
//
// Reading returns "" (or null) instead, which the callers already handle: they were written
// against `String(x ?? "")`, so an absent field was always the empty string.

/** The value when it is a string, else `""`. For a field the caller then validates or defaults. */
export const readString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A value rendered for a HUMAN — an error message naming what was rejected.
 *
 * Here the input is bad by definition, so there is something to say about any of it; `String()` is
 * wrong only because "[object Object]" tells the reader nothing. JSON keeps the shape visible.
 */
export const describeValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]"; // a circular structure, which JSON.stringify throws on
  }
};
