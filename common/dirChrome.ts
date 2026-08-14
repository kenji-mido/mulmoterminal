// The `.mulmoterminal.json` fields whose type is the SAME on both sides. Shared across the
// build boundary: the server's DirConfig/PublicDirConfig and the client's DirConfig
// all extend this, so a field added on one side can't go missing on the other.
// `theme` and `colors` stay out of it — each side declares them with its own type
// (the server keeps the validated strings, the client narrows them to xterm's ITheme).
import type { HeaderStatusColors, HeaderStatusTint } from "./headerStatusColors.js";

export interface DirChrome {
  name: string | null;
  badgeColor: string | null;
  // The cell header's own background / text color (grid cell + single view). Hex
  // #rrggbb, or null to keep the theme default. Distinct from `colors` (the xterm
  // palette) — these tint the chrome around the terminal, not the terminal itself.
  headerColor: string | null;
  headerTextColor: string | null;
  // What the header shows once a status REPLACES that background — working / done / blocked
  // (common/headerStatusColors.ts). null means "not configured here", so a directory that says
  // nothing falls through to the global default rather than asserting the built-in over it.
  headerStatusColors: HeaderStatusColors | null;
  headerStatusTint: HeaderStatusTint | null;
  // The cell frame + accents (grid cell): body background, border, the idle status
  // dot, and the header's icon buttons. Hex #rrggbb or null for the theme default.
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
  // xterm font size in px for terminals opened here, or null to use the global setting.
  // Unlike the colors above, this changes the cell metrics — every path that applies it has
  // to re-fit and push the new cols/rows to the PTY, or the grid drifts from the canvas.
  fontSize: number | null;
  // The CSS font-family stack for terminals opened here, or null to use the global setting.
  // Changes the cell metrics for the same reason `fontSize` does — a different face has a
  // different advance width — so it re-fits on the same path.
  fontFamily: string | null;
  // Where this directory's cells sit in the grid's "priority" sort order — ascending, and
  // null (unset) sorts last so adding it to one directory doesn't displace every other cell.
  // Only that one sort mode reads it; "auto" and "manual" ignore it entirely.
  orderPriority: number | null;
}

// "Nothing configured" — the base every DirConfig/PublicDirConfig empty spreads, so adding
// a field above can't leave one side's default silently missing. Readonly because it is now
// one object behind both sides' defaults, where it used to be a literal per file: a caller
// that assigned it somewhere mutable would corrupt every later "no config here".
export const EMPTY_DIR_CHROME: Readonly<DirChrome> = {
  name: null,
  badgeColor: null,
  headerColor: null,
  headerTextColor: null,
  headerStatusColors: null,
  headerStatusTint: null,
  cellColor: null,
  cellBorderColor: null,
  dotColor: null,
  buttonColor: null,
  fontSize: null,
  fontFamily: null,
  orderPriority: null,
};
