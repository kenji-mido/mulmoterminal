import { describe, it, expect } from "vitest";
import { isUsableTerminalSize, parseTerminalSize, MAX_TERM_COLS, MAX_TERM_ROWS, MIN_TERM_COLS, MIN_TERM_ROWS } from "../../common/terminalSize";
import { isResizeFrame } from "../../server/session/ws-frames";

describe("isUsableTerminalSize", () => {
  it("accepts an ordinary terminal and both ends of the range", () => {
    expect(isUsableTerminalSize({ cols: 131, rows: 41 })).toBe(true);
    expect(isUsableTerminalSize({ cols: MIN_TERM_COLS, rows: MIN_TERM_ROWS })).toBe(true);
    expect(isUsableTerminalSize({ cols: MAX_TERM_COLS, rows: MAX_TERM_ROWS })).toBe(true);
  });

  it("rejects what must never reach node-pty", () => {
    expect(isUsableTerminalSize({ cols: 0, rows: 0 })).toBe(false);
    expect(isUsableTerminalSize({ cols: MAX_TERM_COLS + 1, rows: 40 })).toBe(false);
    expect(isUsableTerminalSize({ cols: 100, rows: MAX_TERM_ROWS + 1 })).toBe(false);
    expect(isUsableTerminalSize({ cols: 80.5, rows: 24 })).toBe(false);
    expect(isUsableTerminalSize({ cols: Number.NaN, rows: 24 })).toBe(false);
  });
});

describe("parseTerminalSize", () => {
  it("reads the pair a connect URL carries", () => {
    expect(parseTerminalSize("131", "41")).toEqual({ cols: 131, rows: 41 });
  });

  // Null is "spawn at the default and wait for the resize frame" — every client behaved that way
  // before the geometry was sent, so a URL that names nothing usable must land back there rather
  // than on a made-up size.
  it("answers null for anything it cannot stand behind", () => {
    expect(parseTerminalSize(null, "41")).toBeNull();
    expect(parseTerminalSize("131", null)).toBeNull();
    expect(parseTerminalSize("", "")).toBeNull();
    expect(parseTerminalSize("abc", "41")).toBeNull();
    expect(parseTerminalSize("0", "0")).toBeNull();
    expect(parseTerminalSize("100000", "41")).toBeNull();
  });
});

// The URL's geometry and a `resize` frame answer one question — which sizes may reach node-pty —
// so they are held to one set of bounds. Two copies would let a size the frame refuses arrive
// through the URL instead.
describe("the URL and the resize frame agree on what is allowed", () => {
  const cases = [
    { cols: 131, rows: 41 },
    { cols: 1, rows: 41 },
    { cols: MAX_TERM_COLS, rows: MAX_TERM_ROWS },
    { cols: MAX_TERM_COLS + 1, rows: MAX_TERM_ROWS + 1 },
    { cols: 0, rows: 0 },
  ];
  it.each(cases)("$cols x $rows", ({ cols, rows }) => {
    expect(parseTerminalSize(String(cols), String(rows)) !== null).toBe(isResizeFrame({ type: "resize", cols, rows }));
  });
});
