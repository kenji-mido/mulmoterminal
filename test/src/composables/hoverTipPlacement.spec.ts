// Where the hover tip lands (#1235). Both rules exist because of a geometry the grid actually
// reaches: nine cells means a header chip sits within a tip's width of the right edge and within a
// tip's height of the bottom, routinely.
import { describe, it, expect } from "vitest";
import { placeHoverTip, type TipRect } from "../../../src/composables/hoverTipPlacement";

const anchor = (over: Partial<TipRect> = {}): TipRect => ({ top: 100, bottom: 120, left: 200, right: 260, ...over });
const TIP = { width: 300, height: 80 };
const SCREEN = { width: 1400, height: 900 };

describe("placeHoverTip", () => {
  it("sits just below the chip, left-aligned with it", () => {
    expect(placeHoverTip(anchor(), TIP, SCREEN)).toEqual({ top: 126, left: 200 });
  });

  // A cell in the bottom row: below would be off-screen, and nothing scrolls a fixed element back.
  it("flips above when there is no room below", () => {
    expect(placeHoverTip(anchor({ top: 830, bottom: 850 }), TIP, SCREEN)).toEqual({ top: 744, left: 200 });
  });

  // Neither side fits — a short window. Below is the lesser evil: above would put the HEAD of the
  // tip off the top, where the first line, the one that names the thing, is the part that is lost.
  it("stays below when it fits neither way", () => {
    expect(placeHoverTip(anchor({ top: 60, bottom: 80 }), { width: 300, height: 400 }, { width: 1400, height: 420 })).toEqual({ top: 86, left: 200 });
  });

  it("pulls back inside the right edge for a chip in the last column", () => {
    // 1380 - 8 - 300 = 1072: flush against the margin rather than 300px off-screen.
    expect(placeHoverTip(anchor({ left: 1300, right: 1380 }), TIP, { width: 1380, height: 900 })).toEqual({ top: 126, left: 1072 });
  });

  it("never crosses the left edge", () => {
    expect(placeHoverTip(anchor({ left: 2, right: 60 }), TIP, SCREEN).left).toBe(8);
  });

  // A narrow phone-width window with a wide tip: clamping to `viewport - tip` would compute a
  // NEGATIVE left and push the start of every line off-screen.
  it("clamps to the left edge when the tip is wider than the window", () => {
    expect(placeHoverTip(anchor({ left: 40, right: 90 }), { width: 500, height: 80 }, { width: 320, height: 700 }).left).toBe(8);
  });
});
