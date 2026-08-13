// A terminal's geometry, and what counts as a usable one.
//
// Shared because BOTH sides decide from it: the browser puts the size it has already measured on
// the connect URL so the pty is born with it (#1178), and the server validates that number before
// it reaches node-pty — a crafted or buggy client must not be able to ask for a 0-column or
// absurdly large terminal. Two copies of these bounds would let the two sides disagree about which
// sizes exist at all.
export interface TerminalSize {
  cols: number;
  rows: number;
}

export const MIN_TERM_COLS = 2;
export const MAX_TERM_COLS = 500;
export const MIN_TERM_ROWS = 1;
export const MAX_TERM_ROWS = 200;

export function isUsableTerminalSize({ cols, rows }: TerminalSize): boolean {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return false;
  return cols >= MIN_TERM_COLS && cols <= MAX_TERM_COLS && rows >= MIN_TERM_ROWS && rows <= MAX_TERM_ROWS;
}

/** The geometry a connect URL carries, or null when it carries none it can stand behind — an
 *  absent, unparsable or out-of-range pair. Null means "spawn at the default and wait for the
 *  browser's resize", which is what every client did before this was sent. */
export function parseTerminalSize(cols: string | null, rows: string | null): TerminalSize | null {
  if (cols === null || rows === null) return null;
  const size = { cols: Number(cols), rows: Number(rows) };
  return isUsableTerminalSize(size) ? size : null;
}
