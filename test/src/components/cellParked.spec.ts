import { describe, it, expect } from "vitest";
import { isCellSunk, SUNK_CELL, SUNK_DOT_STATUS } from "../../../src/components/cellParked";
import { CELL_DOT_WORKING } from "../../../src/components/cellChromeClasses";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const STATUSES = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];

describe("isCellSunk", () => {
  it("sinks a parked cell that is not blocked", () => {
    for (const status of ["idle", "working", "done"] satisfies AttentionStatus[]) {
      expect(isCellSunk(true, status)).toBe(true);
    }
  });

  it("never sinks a cell that is not parked", () => {
    for (const status of STATUSES) {
      expect(isCellSunk(false, status)).toBe(false);
    }
  });

  // Parking must not be able to hide a session that has STOPPED for an answer. Nothing proceeds
  // there until the user acts, so missing it is worse than the clutter parking removes — this is
  // the accident the feature could otherwise cause.
  it("never sinks a blocked cell", () => {
    expect(isCellSunk(true, "blocked")).toBe(false);
  });

  // `done` is deliberately NOT an exception: a parked agent finishing its turn is the expected
  // outcome of parking it, and un-sinking there would undo the setting on its own.
  it("still sinks a parked cell whose turn has ended", () => {
    expect(isCellSunk(true, "done")).toBe(true);
  });
});

describe("the sunk look", () => {
  // Opacity ALONE. The status maps in TerminalCell own every border, background and ink, and two
  // utilities setting one property are resolved by Tailwind's output order rather than by intent.
  it("uses only a property no status branch sets", () => {
    expect(SUNK_CELL).toMatch(/^opacity-\d+$/);
  });

  // What a parked cell stops paying for is MOTION at the edge of vision, so the working dot has
  // to hold still. Pinned against the live class, not a copy of it: the point is that the two
  // differ by exactly the animation.
  it("drops the pulse from the working dot and keeps its colour", () => {
    expect(CELL_DOT_WORKING).toContain("animate-cell-pulse");
    expect(SUNK_DOT_STATUS.working).not.toContain("animate-cell-pulse");
    expect(CELL_DOT_WORKING.split(" ")).toContain(SUNK_DOT_STATUS.working);
  });

  it("names a value for every status, so no caller has to handle an absence", () => {
    for (const status of STATUSES) {
      expect(SUNK_DOT_STATUS[status]).toBeTruthy();
    }
  });
});
