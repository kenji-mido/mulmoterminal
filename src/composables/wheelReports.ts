// The wheel half of the #729 mouse-tracking swallow. Dropping the tracking SETs keeps a drag
// a text selection, but it also hides the wheel from the app: xterm then treats an alt-buffer
// app as "no scrollback, no mouse" and converts wheel events into arrow keys — which a TUI
// like Claude binds to input history, so scrolling span the prompt history instead (#737).
//
// The repair: remember which tracking modes were swallowed, and when the swallowed app is in
// the alternate buffer, hand it the wheel as the SGR mouse report it originally asked for.
// The app scrolls its own transcript again; drags stay selections.

const WHEEL_TRACKING_MODES = new Set([1000, 1001, 1002, 1003]);
const SGR_ENCODING_MODE = 1006;

const modeOf = (param: number | number[]): number | undefined => (Array.isArray(param) ? param[0] : param);

/** Record the modes of a swallowed SET, so the wheel handler knows what the app wanted. */
export function recordSwallowedModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.add(mode);
  });
}

/** Forget modes the app reset — resets pass through to xterm untouched (#729), but the
 *  record must follow them or a closed TUI would keep synthesizing reports forever. */
export function clearResetModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.delete(mode);
  });
}

/** True when the app asked for wheel-capable tracking AND the SGR encoding. Non-SGR
 *  encodings are deliberately out of scope: every current target (Claude, Codex) requests
 *  1006, and synthesizing legacy X10 bytes for the rest isn't worth the surface. */
export function wantsWheelReports(active: ReadonlySet<number>): boolean {
  if (!active.has(SGR_ENCODING_MODE)) return false;
  return [...active].some((mode) => WHEEL_TRACKING_MODES.has(mode));
}

/** The SGR wheel report for a wheel movement, or null when there is no vertical motion.
 *  Button 64 is wheel-up, 65 wheel-down; col/row are 1-based cell coordinates. */
export function wheelReportSequence(deltaY: number, col: number, row: number): string | null {
  if (deltaY === 0) return null;
  const button = deltaY < 0 ? 64 : 65;
  return `\x1b[<${button};${col};${row}M`;
}

/** The touch half of the wheel repair: a phone has no wheel, so a vertical drag on the
 *  terminal is converted into the same wheel steps the desktop wheel produces. This tracker
 *  turns a stream of touch Y positions into whole wheel steps — POSITIVE = wheel-down (the
 *  finger moved UP, pulling later content into view, matching natural touch scrolling) — and
 *  carries the sub-step remainder so a slow drag still adds up instead of being truncated
 *  away move by move. */
export class TouchScrollTracker {
  private lastY: number | null = null;
  private carry = 0;

  start(y: number): void {
    this.lastY = y;
    this.carry = 0;
  }

  /** Feed the next Y position; returns the wheel steps to emit for this move (0 while the
   *  accumulated drag is still shorter than one line of `linePx` pixels). */
  move(y: number, linePx: number): number {
    if (this.lastY === null || linePx <= 0) return 0;
    this.carry += this.lastY - y;
    this.lastY = y;
    const steps = Math.trunc(this.carry / linePx);
    this.carry -= steps * linePx;
    return steps;
  }

  end(): void {
    this.lastY = null;
    this.carry = 0;
  }
}
