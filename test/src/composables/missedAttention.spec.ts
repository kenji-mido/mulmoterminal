import { describe, it, expect } from "vitest";
import { missedMarkFor, type MissedInput } from "../../../src/composables/missedAttention";

const row = (over: Partial<MissedInput> = {}): MissedInput => ({ closed: false, firstSighting: false, waiting: false, suppressed: false, ...over });

describe("missedMarkFor", () => {
  it("marks a beep that could not be sounded", () => {
    expect(missedMarkFor(row({ suppressed: true, waiting: true }))).toBe("mark");
  });

  it("marks a finished turn whose beep was suppressed, even with no attention flag", () => {
    // An actively-viewed pane's Stop clears `working` without raising `waiting`; the user still
    // was not told the turn ended, so suppression outranks the absent flag.
    expect(missedMarkFor(row({ suppressed: true, waiting: false }))).toBe("mark");
  });

  it("marks a session that was ALREADY waiting when the page loaded", () => {
    // The reload case: the first row is baseline-only, so nothing announced this.
    expect(missedMarkFor(row({ firstSighting: true, waiting: true }))).toBe("mark");
  });

  it("does not mark a first sighting that is not asking for anything", () => {
    expect(missedMarkFor(row({ firstSighting: true, waiting: false }))).toBe("clear");
  });

  it("leaves an announced waiting state alone", () => {
    expect(missedMarkFor(row({ waiting: true }))).toBe("none");
  });

  it("clears once the session stops asking", () => {
    expect(missedMarkFor(row({ waiting: false }))).toBe("clear");
  });

  it("clears on close, whatever else the row says", () => {
    expect(missedMarkFor(row({ closed: true, waiting: true, suppressed: true, firstSighting: true }))).toBe("clear");
  });

  it("close outranks a suppressed beep — there is nothing left to go and look at", () => {
    expect(missedMarkFor(row({ closed: true, suppressed: true }))).toBe("clear");
  });
});
