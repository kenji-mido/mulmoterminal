// Reading markers OUT of a pty stream — the opposite direction from pty-text.ts, which
// sanitizes text we type INTO one. Used by the draft-injection scanner to recognize
// claude's "input box is ready" hint and its trust dialog.
//
// The stream is not the screen. A TUI redraws by positioning the cursor between words, so
// the bytes carrying "? for shortcuts" arrive as
//
//   ?ESC[24GforESC[28Gshortcuts
//
// and a plain-text regex over raw pty data never matches. That is how the draft readiness
// marker became dead code: every claude spawn fell through to the 6-second quiet fallback,
// which is why a chat started from the collection UI sat ~10s before its prompt appeared.
// The trust-dialog guard was matched the same way and had the same hole.
//
// So markers are matched against a SQUASHED form: escape sequences, control bytes and ALL
// whitespace removed, lowercased. Dropping whitespace rather than replacing each escape
// with a space is what makes it hold in both directions — an escape between two words and
// one that lands inside a word squash identically — and marker strings are distinctive
// enough that losing the spaces cannot make one match something else.
//
// Markers written for this function therefore carry no spaces: /\?forshortcuts/, not
// /\? for shortcuts/.

/** The escape byte itself, shared so a caller composing its own pattern spells it the same way. */
export const ESC = "\u001b";
const BEL = "\u0007";

// The three escape shapes screen-rows.ts splits on, with the full CSI parameter range
// rather than just digits (a stream carries ESC[?2004h and ESC[>4;2m, a capture does not):
//
//   ESC ] <text> (BEL | ESC \)  |  ESC [ <params> <intermediates> <final>  |  ESC <byte>
//
// Composed from the control bytes rather than written as one literal, for the same reason
// as there: a regex literal carrying them is what the control-character lint rules forbid.
const ESCAPES = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[@-_]`, "gu");

// Whatever control bytes survive escape removal (a stray BEL, a sequence split across two
// reads). Not text, and never part of a marker.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES = /[\u0000-\u001F\u007F-\u009F]/gu;

const LINE_BREAK = "\n";

/** A pty read as plain text: escapes and control bytes gone, line breaks kept. What a person reads
 *  when they want to know what a terminal was showing — squashForMarker drops the breaks again
 *  along with the rest of the whitespace, so nothing that matches markers is affected. */
export const stripPtyEscapes = (data: string): string => data.replace(ESCAPES, "").replace(CONTROL_BYTES, (byte) => (byte === LINE_BREAK ? LINE_BREAK : ""));

/** A pty read reduced to the form markers are matched against: no escapes, no control
 *  bytes, no whitespace, lowercase. */
export const squashForMarker = (data: string): string => stripPtyEscapes(data).replace(/\s+/gu, "").toLowerCase();

// Claude opens on a trust prompt in a directory it has not seen. Two watchers of a pty have to
// recognise it, for opposite reasons: the draft scanner must NOT type into it (the dialog discards
// the text), and the rate-limit probe reports it as the reason it never answered (#1293).
const TRUST_PROMPT_MARKER = /yes,itrustthisfolder|projectyoucreatedoroneyoutrust/g;

// The dialog's text ALONE is not the question — "was it painted" and "is it still on screen" are
// different facts. An answering repaint carries the dismissed dialog and the new screen in ONE
// burst, so text-alone reads an answered dialog as an open one.
//
// What separates them is what FOLLOWS the dialog. Up, it is the last thing painted: a couple of
// short lines (the second option, the confirm hint) and then the stream stops, since nothing paints
// while it waits for an answer. Answered, a whole screen is drawn after it.
//
// The threshold is deliberately far below a screen and comfortably above the dialog's own tail
// (~40 characters squashed): the failure it must not have is reading an ANSWERED dialog as an open
// one.
const TRUST_TAIL_MAX = 120;

/** Is the trust dialog what the screen is CURRENTLY showing? Takes a SQUASHED screen. Scans for the
 *  last match because a repaint can hold several: the answered dialog earlier in the burst, and any
 *  older one still in the tail the caller keeps. */
export const trustDialogIsUp = (screen: string): boolean => {
  let end = -1;
  for (const match of screen.matchAll(TRUST_PROMPT_MARKER)) end = match.index + match[0].length;
  return end !== -1 && screen.length - end <= TRUST_TAIL_MAX;
};
