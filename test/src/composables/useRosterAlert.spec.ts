import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// The composable holds module-level state seeded from localStorage at import time, so each case
// re-imports it with the storage it wants. resetModules is what makes the seeding observable.
const load = async () => {
  vi.resetModules();
  return (await import("../../../src/composables/useRosterAlert")).useRosterAlert();
};

describe("useRosterAlert", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("blinks by default — a user who has never opened Settings gets the signal", async () => {
    const { blink } = await load();
    expect(blink.value).toBe(true);
  });

  it("remembers being turned off", async () => {
    const { setBlink } = await load();
    setBlink(false);
    expect(localStorage.getItem("rosterAlertBlink")).toBe("off");
    const { blink } = await load();
    expect(blink.value).toBe(false);
  });

  it("comes back on, and persists that too", async () => {
    localStorage.setItem("rosterAlertBlink", "off");
    const { blink, setBlink } = await load();
    expect(blink.value).toBe(false);
    setBlink(true);
    expect(blink.value).toBe(true);
    expect(localStorage.getItem("rosterAlertBlink")).toBe("on");
  });

  // Only the explicit "off" is off. Anything else is someone who never chose, and the default is
  // what they should get — not a silent opt-out from a value we cannot read.
  it("treats a blank or unrecognised stored value as the default", async () => {
    for (const stored of ["", "  ", "false", "0", "nope"]) {
      localStorage.setItem("rosterAlertBlink", stored);
      const { blink } = await load();
      expect(blink.value).toBe(true);
    }
  });

  // Private mode and storage-blocked contexts throw on access. The setting is a preference, not
  // state the app needs, so it degrades to "applies this session" rather than breaking the grid.
  it("survives storage that throws, in both directions", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { blink, setBlink } = await load();
    expect(blink.value).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setBlink(false)).not.toThrow();
    expect(blink.value).toBe(false);
  });
});
