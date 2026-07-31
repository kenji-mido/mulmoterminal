import { describe, it, expect } from "vitest";

import { CELL_ACTIONS, CELL_HEADER, CELL_HEADER_MAIN } from "../../../src/components/cellChromeClasses";

// The header wraps so the close button can never run off the edge of a phone. That guarantee is
// worth keeping — but it was firing on every ordinary session, putting the actions on a second row
// while the left half sat on the first with room to spare, which is three stacked bars above a
// terminal that has none to give.
//
// The cause is flex-basis, and it is invisible unless you know to look: `flex-wrap` decides where
// the line breaks BEFORE anything is allowed to shrink, using each item's basis. `flex-auto` bases
// on content, so the left half asks for every pixel its chips need and pushes the actions down;
// `flex-1` bases on 0, so both fit and it grows into the remainder. The two spellings look
// interchangeable and are not.
//
// Asserted as the pairing rather than as one class, because the bug is the COMBINATION: either
// half is fine alone, and a future edit that reaches for the familiar `flex-auto` brings the
// second row straight back.
describe("the cell header stays one row", () => {
  it("bases the left half on 0, since the header wraps", () => {
    expect(CELL_HEADER).toContain("flex-wrap");
    expect(CELL_HEADER_MAIN).toContain("flex-1");
    expect(CELL_HEADER_MAIN).not.toContain("flex-auto");
  });

  // It can shrink to nothing; the actions cannot shrink at all. That is the division of labour
  // that lets a long path and a full set of buttons share one row.
  it("lets the left half shrink and holds the actions at their size", () => {
    expect(CELL_HEADER_MAIN).toContain("min-w-0");
    expect(CELL_ACTIONS).toContain("flex-none");
  });
});
