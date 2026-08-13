import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { CELL_STATUS, DOT_STATUS, HEADER_STATUS } from "../../../src/components/cellStatusClasses";
import { SUNK_DOT_STATUS } from "../../../src/components/cellParked";
import { rosterAlertClass } from "../../../src/components/rosterAlertClasses";
import CockpitHeader from "../../../src/components/CockpitHeader.vue";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const STATUSES = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];

// Whether a class string paints with the `--done` token, in either of the two forms a Tailwind
// utility can name it: the mapped colour (`bg-done`, `border-l-done`) or the variable inside an
// arbitrary value (`color-mix(…var(--done)…)`).
//
// Asserting on the TOKEN rather than on `#22c55e` is the point of these tests: what #1307 was
// about is whether the views share one source for the colour, not what that source evaluates to
// today. A future change to the green must not need any of this rewritten.
const namesDone = (cls: string): boolean => cls.split(" ").some((utility) => utility.endsWith("-done")) || cls.includes("var(--done)");

describe("cellStatusClasses", () => {
  it("gives every status a frame, a header and a dot", () => {
    for (const status of STATUSES) {
      expect(CELL_STATUS[status]).toBeTruthy();
      expect(HEADER_STATUS[status]).toBeTruthy();
      expect(DOT_STATUS[status]).toBeTruthy();
    }
  });

  // Two `bg-*` (or two `border-*`) utilities on one element are resolved by Tailwind's output
  // order rather than by these maps, so a branch that named only what it changes would inherit
  // whichever of the two the build happened to emit last.
  it("names a border in every frame branch and a background in every header and dot branch", () => {
    for (const status of STATUSES) {
      expect(CELL_STATUS[status]).toMatch(/(^| )border-/);
      expect(HEADER_STATUS[status]).toMatch(/(^| )bg-/);
      expect(DOT_STATUS[status]).toMatch(/(^| )bg-/);
    }
  });

  // The regression #1307 reported: the cell ringed a finished turn in the theme ACCENT, which is
  // the same blue `working` uses — so done and working looked alike on a tile, and the same
  // session turned from blue to green the moment it was enlarged into the roster.
  it("paints done with the done token and never with the accent", () => {
    for (const cls of [CELL_STATUS.done, HEADER_STATUS.done, DOT_STATUS.done]) {
      expect(namesDone(cls)).toBe(true);
      expect(cls).not.toContain("accent");
    }
  });

  // The other half of that split: `working` must stay the accent, or unifying done would move the
  // collision rather than remove it.
  it("leaves working on the accent", () => {
    expect(CELL_STATUS.working).toContain("accent");
    expect(HEADER_STATUS.working).toContain("accent");
    expect(namesDone(CELL_STATUS.working)).toBe(false);
    expect(namesDone(HEADER_STATUS.working)).toBe(false);
  });

  it("leaves blocked on amber", () => {
    expect(CELL_STATUS.blocked).toContain("amber");
    expect(HEADER_STATUS.blocked).toContain("amber");
    expect(DOT_STATUS.blocked).toContain("amber");
  });
});

// The cell and the roster are deliberately two components with two class sets (a roster row is not
// a TerminalCell — docs/grid-view-modes.md). What they may NOT do is disagree about what a state
// looks like, which is what happened to `done` for as long as nothing could compare them.
describe("done reads the same in every view", () => {
  it("names the token in the cell frame, header and dot, and in a sunk cell's dot", () => {
    expect(namesDone(CELL_STATUS.done)).toBe(true);
    expect(namesDone(HEADER_STATUS.done)).toBe(true);
    expect(namesDone(DOT_STATUS.done)).toBe(true);
    expect(namesDone(SUNK_DOT_STATUS.done)).toBe(true);
  });

  it("names the token in the roster row's edge, wash and ring", () => {
    const row = rosterAlertClass("done", { expanded: false, blink: true, parked: false });
    expect(row).toContain("border-l-done");
    expect(row).toContain("bg-[color-mix(in_srgb,var(--done)_8%,var(--bg-panel))]");
    expect(row).toContain("shadow-[0_0_0_1px_color-mix(in_srgb,var(--done)_45%,transparent)]");
  });

  it("names the token in the roster and thumbnail header's dot and pill", () => {
    const props = { status: "done" as const, agent: "claude", cwd: "/home/me/proj", home: "/home/me", headerColor: null, headerTextColor: null };
    const w = mount(CockpitHeader, { props });
    expect(namesDone(w.get('[data-testid="cockpit-dot"]').classes().join(" "))).toBe(true);
    expect(namesDone(w.get('[data-testid="cockpit-badge"]').classes().join(" "))).toBe(true);
  });
});
