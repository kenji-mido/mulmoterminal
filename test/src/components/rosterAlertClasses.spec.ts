import { describe, it, expect } from "vitest";
import { rosterAlertClass } from "../../../src/components/rosterAlertClasses";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const BLINK = "animate-roster-alert";
// The status lives in the RING now — the 3px `border-l` stripe these used to name was removed
// once the ring carried the same colour at the same strength all the way round the row.
const AMBER_RING = "shadow-[0_0_0_2px_#f59e0b]";
const GREEN_RING = "shadow-[0_0_0_2px_var(--done)]";
const BLUE_RING = "shadow-[0_0_0_2px_#4a9eff]";

describe("rosterAlertClass", () => {
  it("blinks the row whose agent is waiting on the user", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: true, parked: false });
    expect(cls).toContain(BLINK);
    expect(cls).toContain(AMBER_RING);
  });

  // Off must not take the highlight away with the motion: the row still has to be findable, which
  // is why the setting is about blinking rather than about the alert.
  it("keeps the amber ring and wash when blinking is off", () => {
    const cls = rosterAlertClass("blocked", { expanded: false, blink: false, parked: false });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(AMBER_RING);
    expect(cls).toContain("#f59e0b_14%");
  });

  // The strong/weak split: a finished turn wants reading, not chasing, so it never moves — even
  // with blinking on.
  it("never blinks a finished row, and gives it the green ring", () => {
    const cls = rosterAlertClass("done", { expanded: false, blink: true, parked: false });
    expect(cls).not.toContain(BLINK);
    expect(cls).toContain(GREEN_RING);
  });

  // The blue ring already means "you are here" on the expanded row, and a session you are watching
  // shows its own prompt — so the row you are in never alerts, whatever its status.
  it("leaves the expanded row alone, blocked or not", () => {
    for (const status of ["blocked", "done", "working", "idle"] satisfies AttentionStatus[]) {
      const cls = rosterAlertClass(status, { expanded: true, blink: true, parked: false });
      expect(cls).toContain(BLUE_RING);
      expect(cls).not.toContain(BLINK);
      expect(cls).not.toContain(AMBER_RING);
    }
  });

  it("leaves working and idle rows plain", () => {
    for (const status of ["working", "idle"] satisfies AttentionStatus[]) {
      expect(rosterAlertClass(status, { expanded: false, blink: true, parked: false })).toBe(
        "mr-1.5 border-border bg-panel hover:bg-hover shadow-[0_0_0_2px_transparent]",
      );
    }
  });

  // One ring WIDTH for every state, colour the only channel that moves. The widths used to differ
  // (2px blocked, 1px done, none on the rest) and in a column of stacked cards the eye reads the
  // width difference before the colour, so the list looked mis-rendered rather than differently
  // stated. A plain row rings in `transparent` rather than not at all, so the geometry is identical.
  //
  // The expanded row is NOT an exception here, and a 3px cursor ring was tried and reverted: in a
  // list where every row already carries a status ring, a wider blue one reads as another status
  // rather than as the cursor. It is separated by SHAPE instead — see the test below.
  it("rings every branch at the same width", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const expanded of [true, false]) {
        for (const blink of [true, false]) {
          for (const parked of [true, false]) {
            const cls = rosterAlertClass(status, { expanded, blink, parked });
            const rings = cls.match(/shadow-\[0_0_0_(\d+)px_/g) ?? [];
            expect(rings, cls).toHaveLength(1);
            expect(rings[0]).toBe("shadow-[0_0_0_2px_");
          }
        }
      }
    }
  });

  // "Which one am I in?" has to be easier to answer than "which one finished?". The expanded row
  // used to be the QUIETEST branch — a 1px frame, no ring, the theme's own background — beside a
  // `done` row carrying both a coloured ring and a tinted body.
  //
  // Since every ring is now full strength, the FRAME is what separates the cursor from a status: on
  // the expanded row it takes the ring's blue, so ring and frame read as one solid 3px band, where a
  // status row shows 2px of colour and then the neutral hairline. It is the only branch that colours
  // the frame, and this is the test that says so.
  it("gives the expanded row the loudest chrome in the list", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: false });
    expect(cls).toContain(BLUE_RING);
    expect(cls).toContain("border-[#4a9eff]");
    expect(cls).toContain("bg-[color-mix(in_srgb,#4a9eff_16%,var(--bg-panel))]");
    for (const status of ["done", "blocked"] satisfies AttentionStatus[]) {
      expect(rosterAlertClass(status, { expanded: false, blink: false, parked: false })).toContain("border-border");
    }
  });

  // The cursor is separated by SHAPE, not by more colour: square right corners and NO right gutter
  // run it flush to the roster's edge, against the splitter the enlarged terminal begins after, so
  // it reads as joined to that terminal rather than as one more coloured card in a list of coloured
  // cards. Every other branch keeps `mr-1.5`, which is the gutter the aside gave up (`pr-0`) so the
  // expanded row could reach the edge without a negative margin tuned to a padding it cannot see.
  //
  // Its right BORDER goes to 3px because the ring's right segment is clipped away by that flush
  // edge: without it the row shows 3px of colour (1px frame + 2px ring) on three sides and 1px on
  // the fourth, which reads as a mis-drawn border rather than as an opening. All four sides are
  // 3px; only the corners say the row is open.
  //
  // It takes that same 6px back on the LEFT, so it is the same width as its neighbours and simply
  // sits further over: a shift, not a stretch. A wider row would compete with the status ring for
  // "how much does this row matter"; a moved one cannot, since no status shifts a row sideways.
  //
  // No status branch may take either class — a status that changed shape would be saying "you are
  // here" in the cursor's own channel — and the expanded row must never take `mr-1.5` back, which
  // is the whole of what puts it against the terminal.
  it("opens the expanded row's right edge, and only the expanded row's", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const parked of [true, false]) {
        const open = rosterAlertClass(status, { expanded: true, blink: true, parked });
        expect(open).toContain("rounded-r-none");
        expect(open).toContain("border-r-[3px]");
        expect(open).toContain("ml-1.5");
        expect(open).not.toMatch(/\bm[rx]-/);
        const shut = rosterAlertClass(status, { expanded: false, blink: true, parked });
        expect(shut).not.toContain("rounded-r-none");
        expect(shut).not.toContain("border-r-");
        expect(shut).not.toContain("ml-1.5");
        expect(shut).toContain("mr-1.5");
      }
    }
  });

  // The stripe is gone and must not come back: a `border-l-*` would paint the status on one side
  // only, at a width no other side has, which is the asymmetry the ring was widened to replace.
  it("paints no left-only edge on any branch", () => {
    const statuses = ["blocked", "done", "working", "idle"] satisfies AttentionStatus[];
    for (const status of statuses) {
      for (const expanded of [true, false]) {
        for (const parked of [true, false]) {
          expect(rosterAlertClass(status, { expanded, blink: true, parked })).not.toMatch(/\bborder-l-/);
        }
      }
    }
  });

  // Clicking the expanded row does nothing — it is the one you are already on — so it must not
  // light up under the pointer and promise otherwise. It still NAMES a hover, at the resting
  // colour, because a branch that names none leaves the property to Tailwind's output order.
  it("does not brighten the expanded row on hover", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: false });
    expect(cls).toContain("bg-[color-mix(in_srgb,#4a9eff_16%,var(--bg-panel))]");
    expect(cls).toContain("hover:bg-[color-mix(in_srgb,#4a9eff_16%,var(--bg-panel))]");
    expect(cls).not.toContain("hover:bg-hover");
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
    expect(cls).toContain(AMBER_RING);
    expect(cls).toContain(BLINK);
    expect(cls).not.toContain("opacity-45");
  });

  // `done` does NOT outrank parking, unlike `blocked`: a parked agent finishing its turn is what
  // parking it leads to, and floating it back up would undo the setting by itself.
  it("keeps a parked row sunk when its turn ends", () => {
    const cls = rosterAlertClass("done", { expanded: false, blink: true, parked: true });
    expect(cls).toContain("opacity-45");
    expect(cls).not.toContain(GREEN_RING);
  });

  // Selecting a parked session must not make it read as awake — but the blue ring is navigation
  // ("you are here"), not status, so it keeps that AND the sink. Losing either would answer a
  // different question than the one asked.
  it("keeps the expanded row's ring and sinks it when parked", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: true });
    expect(cls).toContain(BLUE_RING);
    expect(cls).toContain("opacity-45");
  });

  it("does not sink the expanded row when it is not parked", () => {
    const cls = rosterAlertClass("idle", { expanded: true, blink: true, parked: false });
    expect(cls).toContain(BLUE_RING);
    expect(cls).not.toContain("opacity-45");
  });

  // Every branch names the frame, the ring AND the background, because two competing utilities for
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
