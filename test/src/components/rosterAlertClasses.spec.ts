import { describe, it, expect } from "vitest";
import { rosterAlertClass } from "../../../src/components/rosterAlertClasses";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const BLINK = "animate-roster-alert";
const AMBER_EDGE = "border-l-[#f59e0b]";
const GREEN_EDGE = "border-l-[#22c55e]";

describe("rosterAlertClass", () => {
  it("blinks the row whose agent is waiting on the user", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: true });
    expect(cls).toContain(BLINK);
    expect(cls).toContain(AMBER_EDGE);
  });

  // Off must not take the highlight away with the motion: the row still has to be findable, which
  // is why the setting is about blinking rather than about the alert.
  it("keeps the amber edge and wash when blinking is off", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: false });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(AMBER_EDGE);
    expect(cls).toContain("#f59e0b_14%");
  });

  // The strong/weak split: a finished turn wants reading, not chasing, so it never moves — even
  // with blinking on.
  it("never blinks a finished row, and gives it the green edge", () => {
    const cls = rosterAlertClass("done", { expanded: false, blink: true });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(GREEN_EDGE);
  });

  // The left edge already means "you are here" on the expanded row, and a session you are watching
  // shows its own prompt — so the row you are in never alerts, whatever its status.
  it("leaves the expanded row alone, blocked or not", () => {
    for (const status of ["blocked", "done", "working", "idle"] satisfies AttentionStatus[]) {
      const cls = rosterAlertClass(status, { expanded: true, blink: true });
      expect(cls).toContain("border-l-[#4a9eff]");
      expect(cls).not.toContain(BLINK);
      expect(cls).not.toContain(AMBER_EDGE);
    }
  });

  it("leaves working and idle rows plain", () => {
    for (const status of ["working", "idle"] satisfies AttentionStatus[]) {
      expect(rosterAlertClass(status, { expanded: false, blink: true })).toBe("border-border border-l-transparent bg-panel");
    }
  });

  // Reduced motion has to win over the setting, so the keyframes are always paired with the
  // utility that cancels them — a row that blinks only because someone forgot this pairing is
  // exactly what an accessibility preference is meant to prevent.
  it("pairs the animation with motion-reduce:animate-none", () => {
    expect(rosterAlertClass("blocked", { expanded: false, blink: true })).toContain("motion-reduce:animate-none");
  });

  // Every branch names the frame, the edge AND the background, because two competing utilities for
  // one property are resolved by Tailwind's output order rather than by the order written here.
  it("names a background in every branch", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const expanded of [true, false]) {
        for (const blink of [true, false]) {
          expect(rosterAlertClass(status, { expanded, blink })).toMatch(/\bbg-/);
        }
      }
    }
  });
});
