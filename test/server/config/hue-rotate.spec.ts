// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rotateHue } from "../../../server/config/hue-rotate";

describe("rotateHue", () => {
  // The primaries sit exactly 120 degrees apart, so a third of a turn has to land each one on
  // the next. If the sector arithmetic is off anywhere, this is where it shows.
  it("walks the primaries a third of a turn at a time", () => {
    expect(rotateHue("#ff0000", 120)).toBe("#00ff00");
    expect(rotateHue("#00ff00", 120)).toBe("#0000ff");
    expect(rotateHue("#0000ff", 120)).toBe("#ff0000");
  });

  it("is a no-op at zero and at a whole turn, and takes a negative rotation", () => {
    expect(rotateHue("#2d4ea9", 0)).toBe("#2d4ea9");
    expect(rotateHue("#2d4ea9", 360)).toBe("#2d4ea9");
    expect(rotateHue("#2d4ea9", -12)).toBe("#2d67a9");
    expect(rotateHue("#2d4ea9", 372)).toBe(rotateHue("#2d4ea9", 12));
  });

  // The reason a config's `headerTextColor: "#ffffff"` needs no special case at the call site:
  // a grey has no hue to move, so a tint leaves it exactly as written.
  it.each(["#ffffff", "#000000", "#808080"])("leaves the grey %s alone", (grey) => {
    expect(rotateHue(grey, 12)).toBe(grey);
    expect(rotateHue(grey, 180)).toBe(grey);
  });

  // Callers pass whatever the config held. Anything that is not a #rrggbb colour comes back
  // untouched rather than becoming a colour it never was.
  it.each(["", "nope", "#abc", "#12345", "#1234567", "rgb(1,2,3)"])("passes %s through unchanged", (input) => {
    expect(rotateHue(input, 12)).toBe(input);
  });

  // The whole point of rotating hue rather than lightness: the colour keeps the weight it was
  // picked for, so a tinted header stays readable against the same text.
  it("keeps the colour's lightness and saturation", () => {
    const rotated = rotateHue("#2d4ea9", 12);
    const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const spread = (hex: string) => Math.max(...channels(hex)) - Math.min(...channels(hex));
    const mid = (hex: string) => (Math.max(...channels(hex)) + Math.min(...channels(hex))) / 2;
    expect(spread(rotated)).toBeCloseTo(spread("#2d4ea9"), -0.5);
    expect(mid(rotated)).toBeCloseTo(mid("#2d4ea9"), -0.5);
  });

  // What a row of worktree cells actually looks like: one project, four distinguishable shades.
  it("steps a project colour into a gradient", () => {
    expect([0, 1, 2, 3].map((n) => rotateHue("#2d4ea9", n * 12))).toEqual(["#2d4ea9", "#2d35a9", "#3e2da9", "#562da9"]);
  });
});
