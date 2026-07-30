import { describe, it, expect } from "vitest";
import { dirChipColor, CHIP_IDLE, CHIP_RUNNING, CHIP_DOT_RUNNING } from "../../../src/components/dirChipColor";

const chrome = (over: Partial<Parameters<typeof dirChipColor>[0]> = {}) => ({
  headerColor: null,
  badgeColor: null,
  cellColor: null,
  dotColor: null,
  ...over,
});

describe("dirChipColor", () => {
  it("has no colour for a directory that configured none", () => {
    expect(dirChipColor(chrome())).toBeNull();
  });

  it("takes the header colour first — it is what the grid makes most visible", () => {
    expect(dirChipColor(chrome({ headerColor: "#112233", badgeColor: "#445566", cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#112233");
  });

  it("falls back through badge, then cell, then dot", () => {
    expect(dirChipColor(chrome({ badgeColor: "#445566", cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#445566");
    expect(dirChipColor(chrome({ cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#778899");
    expect(dirChipColor(chrome({ dotColor: "#aabbcc" }))).toBe("#aabbcc");
  });

  // The value reaches a style binding, so anything the server's schema wouldn't have produced
  // is skipped rather than passed through — and a later field can still supply a real colour.
  it("skips a value that is not 6-digit hex", () => {
    expect(dirChipColor(chrome({ headerColor: "red" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "#fff" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "#12345g" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "javascript:alert(1)", badgeColor: "#445566" }))).toBe("#445566");
  });
});

// The chip draws two independent facts, and the bug was that they shared a channel: a
// colour-coded directory tinted the background exactly the way "running" did, so an idle chip
// read as running (#1106). These pin the split rather than the exact colours — a redesign may
// change the hue, but the background must never go back to meaning two things.
describe("chip class strings", () => {
  it("gives the idle chip no colour of its own — the stripe carries the directory", () => {
    expect(CHIP_IDLE).not.toContain("color-mix");
    expect(CHIP_IDLE).not.toContain("#");
  });

  it("puts the running state on the background and border", () => {
    expect(CHIP_RUNNING).toContain("bg-[");
    expect(CHIP_RUNNING).toContain("border-[");
  });

  // Motion is the one channel a directory's hue cannot imitate, which is what makes a running
  // chip readable even when its directory colour is the same blue.
  it("pulses the running dot, and stops for reduced motion", () => {
    expect(CHIP_DOT_RUNNING).toContain("animate-cell-pulse");
    expect(CHIP_DOT_RUNNING).toContain("motion-reduce:animate-none");
  });

  // Two states that render identically are the bug, whatever each one is made of.
  it("cannot render an idle chip the same as a running one", () => {
    expect(CHIP_IDLE).not.toBe(CHIP_RUNNING);
  });
});
