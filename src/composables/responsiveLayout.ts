// The single view's two responsive decisions. They look like one flag and are not: the width at
// which the sidebar stops fitting beside a terminal is not the width at which the terminal
// should stop sharing with the Canvas.
//
// Here rather than inline in App.vue because both failure directions are quiet — collapse the
// sidebar too eagerly and a desktop user silently loses the layout they chose; hand the terminal
// the full width too late and a phone renders a ~40-column terminal beside a Canvas nobody can
// read. Neither shows up as an error, so the thresholds are worth pinning.

/** Below this the sidebar cannot sit beside a usable terminal (a phone, a folded foldable). */
export const COMPACT_SESSIONS_MAX_PX = 640;
/** A touch device up to this width still wants the terminal to fill (an unfolded foldable). */
export const FILL_TERMINAL_TOUCH_MAX_PX = 1024;

/** Drop the 260px sidebar for the compact top-tab layout. Width alone: above the threshold the
 *  user's own vertical/horizontal preference stands, since it fits either way. */
export function compactSessions(viewportWidth: number): boolean {
  return viewportWidth < COMPACT_SESSIONS_MAX_PX;
}

/** Give the terminal the whole width — no GUI panel, no splitter. Touch matters here and not
 *  above: an unfolded foldable has room for the sidebar but should not also share with the
 *  Canvas, while a desktop of the same width comfortably shows both. */
export function fillTerminal(viewportWidth: number, touchDevice: boolean): boolean {
  return viewportWidth < COMPACT_SESSIONS_MAX_PX || (touchDevice && viewportWidth < FILL_TERMINAL_TOUCH_MAX_PX);
}

/** The layout actually rendered: the user's preference, unless the width cannot honour it. */
export function effectiveSessionLayout<T extends string>(viewportWidth: number, preferred: T, compact: T): T {
  return compactSessions(viewportWidth) ? compact : preferred;
}
