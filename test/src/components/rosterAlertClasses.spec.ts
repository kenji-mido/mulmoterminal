import { describe, it, expect } from "vitest";
import { rosterAlertClass } from "../../../src/components/rosterAlertClasses";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const BLINK = "animate-roster-alert";
const AMBER_EDGE = "border-l-[#f59e0b]";
const GREEN_EDGE = "border-l-done";

describe("rosterAlertClass", () => {
  it("blinks the row whose agent is waiting on the user", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: true, parked: false });
    expect(cls).toContain(BLINK);
    expect(cls).toContain(AMBER_EDGE);
  });

  // Off must not take the highlight away with the motion: the row still has to be findable, which
  // is why the setting is about blinking rather than about the alert.
  it("keeps the amber edge and wash when blinking is off", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: false, parked: false });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(AMBER_EDGE);
    expect(cls).toContain("#f59e0b_14%");
  });

  // The strong/weak split: a finished turn wants reading, not chasing, so it never moves — even
  // with blinking on.
  it("never blinks a finished row, and gives it the green edge", () => {
    const cls = rosterAlertClass("done", { expanded: false, blink: true, parked: false });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(GREEN_EDGE);
  });

  // The left edge already means "you are here" on the expanded row, and a session you are watching
  // shows its own prompt — so the row you are in never alerts, whatever its status.
  it("leaves the expanded row alone, blocked or not", () => {
    for (const status of ["blocked", "done", "working", "idle"] satisfies AttentionStatus[]) {
      const cls = rosterAlertClass(status, { expanded: true, blink: true, parked: false });
      expect(cls).toContain("border-l-[#4a9eff]");
      expect(cls).not.toContain(BLINK);
      expect(cls).not.toContain(AMBER_EDGE);
    }
  });

  it("leaves working and idle rows plain", () => {
    for (const status of ["working", "idle"] satisfies AttentionStatus[]) {
      expect(rosterAlertClass(status, { expanded: false, blink: true, parked: false })).toBe("border-border border-l-transparent bg-panel hover:bg-hover");
    }
  });

  // The state colour has to survive the pointer being on it (#1168): hovering used to brighten the
  // whole row, which on a light theme — where the wash sits a few percent from white — clipped it to
  // pure white, so the one row you were looking at was the one with no colour.
  it("keeps the state colour in the hovered background", () => {
    expect(rosterAlertClass("done", { expanded: false, blink: true, parked: false })).toContain(
      "hover:bg-[color-mix(in_srgb,var(--done)_18%,var(--bg-panel))]",
    );
    expect(rosterAlertClass("blocked", { expanded: false, blink: false, parked: false })).toContain(
      "hover:bg-[color-mix(in_srgb,#f59e0b_24%,var(--bg-panel))]",
    );
  });

  // Same reason the background is named in every branch: with the row's static class no longer
  // carrying a hover of its own, a branch that names none has no hover at all.
  it("names a hover background in every branch", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const expanded of [true, false]) {
        for (const blink of [true, false]) {
          for (const parked of [true, false]) {
            expect(rosterAlertClass(status, { expanded, blink, parked })).toMatch(/\bhover:bg-/);
          }
        }
      }
    }
  });

  // Reduced motion has to win over the setting, so the keyframes are always paired with the
  // utility that cancels them — a row that blinks only because someone forgot this pairing is
  // exactly what an accessibility preference is meant to prevent.
  it("pairs the animation with motion-reduce:animate-none", () => {
    expect(rosterAlertClass("blocked", { expanded: false, blink: true, parked: false })).toContain("motion-reduce:animate-none");
  });

  // A row the user set aside sinks, and says nothing else — the point of parking it (#992).
  it("sinks a parked row", () => {
    const cls = rosterAlertClass("idle", { expanded: false, blink: true, parked: true });
    expect(cls).toContain("opacity-45");
    expect(cls).not.toContain(BLINK);
  });

  // Parking must never cost the user a session that has STOPPED for an answer: nothing proceeds
  // there until they act, so `blocked` outranks it. This is the accident the feature could cause.
  it("keeps the blocked alert on a parked row", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: true, parked: true });
    expect(cls).toContain(AMBER_EDGE);
    expect(cls).toContain(BLINK);
    expect(cls).not.toContain("opacity-45");
  });

  // `done` does NOT outrank parking, unlike `blocked`: a parked agent finishing its turn is what
  // parking it leads to, and floating it back up would undo the setting by itself.
  it("keeps a parked row sunk when its turn ends", () => {
    const cls = rosterAlertClass("done", { expanded: false, blink: true, parked: true });
    expect(cls).toContain("opacity-45");
    expect(cls).not.toContain(GREEN_EDGE);
  });

  // Selecting a parked session must not make it read as awake — but the blue edge is navigation
  // ("you are here"), not status, so it keeps that AND the sink. Losing either would answer a
  // different question than the one asked.
  it("keeps the expanded row's edge and sinks it when parked", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: true });
    expect(cls).toContain("border-l-[#4a9eff]");
    expect(cls).toContain("opacity-45");
  });

  it("does not sink the expanded row when it is not parked", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: false });
    expect(cls).toContain("border-l-[#4a9eff]");
    expect(cls).not.toContain("opacity-45");
  });

  // Every branch names the frame, the edge AND the background, because two competing utilities for
  // one property are resolved by Tailwind's output order rather than by the order written here.
  it("names a background in every branch", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const expanded of [true, false]) {
        for (const blink of [true, false]) {
          for (const parked of [true, false]) {
            // Anchored to a class boundary so a `hover:bg-*` cannot stand in for the resting one.
            expect(rosterAlertClass(status, { expanded, blink, parked })).toMatch(/(^| )bg-/);
          }
        }
      }
    }
  });
});
