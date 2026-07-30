import { describe, it, expect } from "vitest";
import { sessionAttention, sessionDotFor } from "../../../src/composables/sessionList";
import type { Session } from "../../../src/composables/useSessions";

const row = (over: Partial<Session> = {}): Session => ({ id: "a", title: "a", mtime: 1, working: false, waiting: false, ...over });

describe("sessionAttention", () => {
  // The point of the whole change (#1139): the sidebar and the tab bar used to read `waiting` alone,
  // which cannot tell "stopped until you answer" from "finished, unread".
  it("splits a waiting row by the hook that set it", () => {
    expect(sessionAttention(row({ waiting: true, event: "Notification" }))).toBe("blocked");
    expect(sessionAttention(row({ waiting: true, event: "Stop" }))).toBe("done");
  });

  it("reports working and idle", () => {
    expect(sessionAttention(row({ working: true }))).toBe("working");
    expect(sessionAttention(row())).toBe("idle");
  });

  // A list row arrives without `event` from an older server, or from a source that does not set it.
  // It must still count as attention-worthy — losing the row entirely would be worse than losing the
  // distinction.
  it("falls back to done when a waiting row carries no event", () => {
    expect(sessionAttention(row({ waiting: true }))).toBe("done");
  });
});

describe("sessionDotFor", () => {
  it("gives a blocked row amber and a finished row green, with a label for each", () => {
    expect(sessionDotFor(row({ waiting: true, event: "Notification" }))).toEqual({
      cls: expect.stringContaining("bg-[#f59e0b]"),
      label: "Waiting for you",
    });
    expect(sessionDotFor(row({ waiting: true, event: "Stop" }))).toEqual({ cls: expect.stringContaining("bg-[#22c55e]"), label: "Finished — unread" });
  });

  // `working` owns the same slot with its spinner, and the two states cannot co-occur; `idle` has
  // nothing to report.
  it("has no dot for a working or idle row", () => {
    expect(sessionDotFor(row({ working: true }))).toBeNull();
    expect(sessionDotFor(row())).toBeNull();
  });

  // The gate is `isUnread`, not the status: a background worker is deliberately never marked, and
  // `isUnread` is also what drives the bold and the Unread chip. A dot without the bold on the same
  // row would be the very contradiction this change removes.
  it("never marks a background worker, however it is waiting", () => {
    expect(sessionDotFor(row({ waiting: true, event: "Notification", hidden: true }))).toBeNull();
    expect(sessionDotFor(row({ waiting: true, event: "Stop", hidden: true }))).toBeNull();
  });

  // Colour is the entire message for a sighted user, so a dot without a label would be a signal only
  // some people receive.
  it("never returns a dot without an accessible label", () => {
    for (const event of ["Notification", "Stop", null]) {
      const dot = sessionDotFor(row({ waiting: true, event }));
      expect(dot?.label.length).toBeGreaterThan(0);
    }
  });

  // These two panels are on screen the whole time, unlike the roster — motion there is what the
  // roster's setting exists to switch off, so it must not creep in here.
  it("carries no animation utility", () => {
    for (const event of ["Notification", "Stop"]) {
      expect(sessionDotFor(row({ waiting: true, event }))?.cls).not.toMatch(/animate-/);
    }
  });
});
