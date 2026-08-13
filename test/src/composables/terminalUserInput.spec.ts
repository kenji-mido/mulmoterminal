import { describe, it, expect } from "vitest";
import { isTypedInput } from "../../../src/composables/terminalUserInput";
import { clickReportSequences, wheelReportSequence } from "../../../src/composables/mouseReports";

describe("isTypedInput", () => {
  it("counts ordinary characters, control bytes and pastes", () => {
    for (const data of ["a", "hello", "\r", "\x1b\r", "\x03", "多バイト", "a long pasted line\nwith a newline"]) {
      expect(isTypedInput(data)).toBe(true);
    }
  });

  // The reason this predicate exists: a parked cell must survive being CLICKED to read it, and a
  // click on a mouse-tracking app is delivered as input. Built from the same generator the app
  // sends, so a change to the report format cannot leave this matching a shape nobody emits.
  it("rejects the click reports the app synthesizes", () => {
    for (const seq of clickReportSequences(12, 34)) {
      expect(isTypedInput(seq)).toBe(false);
    }
  });

  it("rejects wheel reports, so scrolling a parked cell does not wake it", () => {
    const up = wheelReportSequence(-1, 5, 5);
    const down = wheelReportSequence(1, 5, 5);
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(isTypedInput(up ?? "")).toBe(false);
    expect(isTypedInput(down ?? "")).toBe(false);
  });

  // Not synthesized by this app, but a terminal can still emit it for an app that asked for a
  // non-SGR encoding.
  it("rejects a legacy X10 mouse report", () => {
    expect(isTypedInput("\x1b[M !!")).toBe(false);
  });

  // Clicking a cell moves focus, so focus tracking would be the back door into the same bug.
  it("rejects focus-gained and focus-lost reports", () => {
    expect(isTypedInput("\x1b[I")).toBe(false);
    expect(isTypedInput("\x1b[O")).toBe(false);
  });

  // A CSI sequence that is neither is still the user: arrow keys, Home/End and function keys all
  // arrive this way, and treating "starts with ESC[" as not-typing would swallow them.
  it("counts arrow keys and other CSI keystrokes", () => {
    for (const data of ["\x1b[A", "\x1b[B", "\x1b[3~", "\x1b[1;5C"]) {
      expect(isTypedInput(data)).toBe(true);
    }
  });
});
