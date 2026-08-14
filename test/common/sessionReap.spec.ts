import { describe, it, expect } from "vitest";

import { DEFAULT_REAP_IDLE_DAYS, MAX_REAP_IDLE_DAYS, reapIdleSeconds, reapSweepEnabled, sanitizeReapIdleDays } from "../../common/sessionReap";

// The number that decides when the server ends a session on its own (#1467). A wrong value here is
// either a sweep that never runs or one that runs too eagerly, and neither announces itself.
describe("sanitizeReapIdleDays", () => {
  it("keeps a whole number of days in range", () => {
    expect(sanitizeReapIdleDays(3)).toBe(3);
    expect(sanitizeReapIdleDays(MAX_REAP_IDLE_DAYS)).toBe(MAX_REAP_IDLE_DAYS);
  });

  // Zero is the off switch, so it must survive sanitizing — it is the one value a user picks to
  // stop the behaviour entirely.
  it("keeps zero, which is off", () => {
    expect(sanitizeReapIdleDays(0)).toBe(0);
    expect(reapSweepEnabled(0)).toBe(false);
  });

  // NOT rounded: `Math.round(0.4)` is 0, and 0 is the off switch — so rounding would let a
  // fractional value disable the sweep, which is the silent-disable the fallback exists to stop
  // (CodeRabbit on #1486).
  it.each([2.6, 0.4, 6.999])("refuses the fractional %p rather than rounding it", (value) => {
    expect(sanitizeReapIdleDays(value)).toBe(DEFAULT_REAP_IDLE_DAYS);
  });

  // Falling back to the DEFAULT rather than to 0: a corrupt value silently disabling the sweep
  // looks exactly like the bug this feature fixes, and nobody would think to look here.
  it.each([-1, MAX_REAP_IDLE_DAYS + 1, Number.NaN, Number.POSITIVE_INFINITY, "7", null, undefined, {}])("falls back to the default for %p", (value) => {
    expect(sanitizeReapIdleDays(value)).toBe(DEFAULT_REAP_IDLE_DAYS);
  });
});

describe("reapIdleSeconds", () => {
  it("is the threshold the sweep compares tmux's answer against", () => {
    expect(reapIdleSeconds(1)).toBe(86_400);
    expect(reapIdleSeconds(DEFAULT_REAP_IDLE_DAYS)).toBe(7 * 86_400);
  });
});
