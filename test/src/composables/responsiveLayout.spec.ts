// The rules the single view lays itself out by. Both failure directions are quiet — a desktop
// user silently losing the sidebar they chose, or a phone rendering a ~40-column terminal beside
// a Canvas nobody can read — so the thresholds are pinned rather than left to be re-derived.
import { describe, it, expect } from "vitest";
import {
  COMPACT_SESSIONS_MAX_PX,
  FILL_TERMINAL_TOUCH_MAX_PX,
  compactSessions,
  effectiveSessionLayout,
  fillTerminal,
} from "../../../src/composables/responsiveLayout";

describe("compactSessions", () => {
  it("collapses the sidebar on a phone", () => {
    expect(compactSessions(390)).toBe(true);
  });

  it("keeps it on anything that can fit it", () => {
    expect(compactSessions(1400)).toBe(false);
  });

  // "< 640" and "<= 640" are one character apart and both read fine.
  it("switches exactly at the threshold", () => {
    expect(compactSessions(COMPACT_SESSIONS_MAX_PX - 1)).toBe(true);
    expect(compactSessions(COMPACT_SESSIONS_MAX_PX)).toBe(false);
  });
});

describe("fillTerminal", () => {
  it("fills on a phone, whatever the input device", () => {
    expect(fillTerminal(390, true)).toBe(true);
    expect(fillTerminal(390, false)).toBe(true);
  });

  // The case the two separate rules exist for: room for the sidebar, but not to also share with
  // the Canvas. Collapsing this into one flag loses exactly this width.
  it("fills on an unfolded foldable, which still keeps its sidebar", () => {
    expect(fillTerminal(800, true)).toBe(true);
    expect(compactSessions(800)).toBe(false);
  });

  it("leaves a desktop of the same width sharing with the Canvas", () => {
    expect(fillTerminal(800, false)).toBe(false);
  });

  it("stops filling once a touch device is wide enough for both", () => {
    expect(fillTerminal(FILL_TERMINAL_TOUCH_MAX_PX - 1, true)).toBe(true);
    expect(fillTerminal(FILL_TERMINAL_TOUCH_MAX_PX, true)).toBe(false);
  });
});

describe("effectiveSessionLayout", () => {
  it("honours the user's preference when the width allows it", () => {
    expect(effectiveSessionLayout(1400, "vertical", "horizontal")).toBe("vertical");
    expect(effectiveSessionLayout(1400, "horizontal", "horizontal")).toBe("horizontal");
  });

  it("overrides a vertical preference that cannot fit", () => {
    expect(effectiveSessionLayout(390, "vertical", "horizontal")).toBe("horizontal");
  });
});
