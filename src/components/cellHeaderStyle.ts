// Inline CSS custom properties for a cell header tinted by <cwd>/.mulmoterminal.json
// (`headerColor` = background, `headerTextColor` = text). Emitted as variables — not a
// plain background/color — so the header's status tint (working/blocked) can still
// override the background while idle keeps the custom color, and the dir/prompt text
// pick up --cell-header-fg. A missing / non-hex value is dropped (the theme default
// shows through the var fallback). Shared by the grid cell and the single-view header.
import { isHexColor as isHex } from "../../common/hexColor";
import { headerTextColorFor } from "../../common/chromeFromColor";
import { resolveHeaderPaint, type HeaderChrome, type HeaderPaintStatus } from "../../common/headerStatusColors";

/** For the headers that paint the directory's colour in EVERY state — the roster bar, a filmstrip
 *  thumbnail, the terminal's own header row, the command / launcher cells. A text colour may
 *  always be derived here, because the background it would be derived from is the one on screen.
 *
 *  A grid cell is the exception and calls headerStatusStyleFor instead: a status REPLACES its
 *  background, and an ink chosen for the directory's colour lands on that instead (#1591). */
export function headerStyleFor(background: string | null | undefined, text: string | null | undefined): Record<string, string> {
  const style: Record<string, string> = {};
  if (isHex(background)) style["--cell-header-bg"] = background;
  const ink = declaredOrDerivedInk(background, text);
  if (ink) style["--cell-header-fg"] = ink;
  return style;
}

function declaredOrDerivedInk(background: string | null | undefined, text: string | null | undefined): string | null {
  if (isHex(text)) return text;
  return isHex(background) ? headerTextColorFor(background) : null;
}

/** The grid cell's header, which paints something different in each of the four attention states.
 *
 *  Both variables are emitted ONLY for a state whose colour is known here. `cellStatusClasses.ts`
 *  falls back to the theme's own wash through `var(--cell-header-bg, …)`, so emitting the
 *  directory's colour for a state the theme washes is precisely what would paint the wrong
 *  thing — and leaving the ink behind on a wash is what #1591 was. */
export function headerStatusStyleFor(status: HeaderPaintStatus, chrome: HeaderChrome): Record<string, string> {
  const paint = resolveHeaderPaint(status, chrome);
  const style: Record<string, string> = {};
  if (paint.background) style["--cell-header-bg"] = paint.background;
  if (paint.text) style["--cell-header-fg"] = paint.text;
  return style;
}

// Inline CSS custom properties for the cell frame + accents, set on the cell root so
// descendants inherit them: body background, border, the idle status dot, and the
// header's icon buttons. Like the header vars, the status frame/dot still override
// their targets while working/blocked so activity feedback is preserved.
export function cellStyleFor(
  background: string | null | undefined,
  border: string | null | undefined,
  dot: string | null | undefined,
  button: string | null | undefined,
): Record<string, string> {
  const style: Record<string, string> = {};
  if (isHex(background)) style["--cell-bg"] = background;
  if (isHex(border)) style["--cell-border"] = border;
  if (isHex(dot)) style["--cell-dot"] = dot;
  if (isHex(button)) style["--cell-btn"] = button;
  return style;
}

// The Terminal component's own header row (the grid cell's row 2 and the single view's
// header) reuses the same header colors + button color, via the same CSS vars, so both
// header rows match. Emitted on that header element.
export function terminalHeaderStyleFor(
  background: string | null | undefined,
  text: string | null | undefined,
  button: string | null | undefined,
): Record<string, string> {
  // No status replaces THIS row's background — it is the directory's colour whatever the session is
  // doing — so a derived text colour is always safe here.
  const style = headerStyleFor(background, text);
  if (isHex(button)) style["--cell-btn"] = button;
  return style;
}
