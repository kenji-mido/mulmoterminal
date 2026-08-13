// Where the hover tip goes, given the thing it describes and the room around it (#1235).
//
// Pure, because the two rules it encodes are the whole reason the tip is usable at all and each
// one has a cell geometry that breaks it: a grid runs to nine cells, so a header chip is routinely
// within a tip's width of the viewport edge and within a tip's height of the bottom.

export interface TipRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TipSize {
  width: number;
  height: number;
}

export interface TipViewport {
  width: number;
  height: number;
}

export interface TipPosition {
  top: number;
  left: number;
}

/** Between the anchor and the tip, and between the tip and the viewport edge. */
const GAP_PX = 6;
const EDGE_PX = 8;

// Below the anchor unless the tip would run off the bottom, in which case above it. Flipping
// rather than shrinking: a tip that fits by wrapping to six lines is not more readable than one
// that moved.
function verticalTop(anchor: TipRect, tip: TipSize, viewport: TipViewport): number {
  const below = anchor.bottom + GAP_PX;
  if (below + tip.height <= viewport.height - EDGE_PX) return below;
  const above = anchor.top - GAP_PX - tip.height;
  // Only when there is genuinely room above: a tall tip against a short viewport would otherwise
  // be placed off the top, which is worse than overflowing the bottom (nothing scrolls it back).
  return above >= EDGE_PX ? above : below;
}

// Left-aligned with the anchor, then pulled back inside the viewport. The pull is what a chip at
// the right-hand edge of the last grid column needs, and it is why the tip is not simply
// `position: absolute` next to the chip.
function horizontalLeft(anchor: TipRect, tip: TipSize, viewport: TipViewport): number {
  const rightMost = viewport.width - EDGE_PX - tip.width;
  // A tip wider than the viewport clamps to the left edge rather than to a negative `rightMost`.
  return Math.round(Math.max(EDGE_PX, Math.min(anchor.left, Math.max(EDGE_PX, rightMost))));
}

export function placeHoverTip(anchor: TipRect, tip: TipSize, viewport: TipViewport): TipPosition {
  return { top: Math.round(verticalTop(anchor, tip, viewport)), left: horizontalLeft(anchor, tip, viewport) };
}
