// @vitest-environment node
// One brand colour to seven chrome colours (#1442).
//
// The derivation was chosen by measurement against eleven hand-tuned palettes, so the test that
// matters is the same measurement: does it still land inside the threshold where a colour
// difference becomes noticeable? Retuning the constants without re-running this is how a "tidier"
// model quietly makes every project's cell the wrong colour.
import { describe, it, expect } from "vitest";
import { chromeFromColor, parseHex, normalizeHex, type ChromeColors } from "../../common/chromeFromColor";
import { contrastRatio, relativeLuminance } from "../../common/contrast";

// ΔE76 in CIE Lab. 2.3 is the classic "just noticeable difference"; the measured worst case across
// these palettes is 2.5, on one role at the dark end of the hue wheel, so the bound asserted here
// is where the model actually sits rather than where it would be nice for it to sit. Tightening
// the model is welcome; loosening this number to make a change pass is not.
const MEASURED_WORST = 2.6;

function deltaE(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const rgb = parseHex(hex);
    if (!rgb) throw new Error(`not a colour: ${hex}`);
    const lin = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4)));
    const [r, g, bl] = lin;
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.sqrt((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2);
}

// Palettes tuned by hand, before any of this existed. Six repositories across two hue families.
const HAND_TUNED = [
  { primary: "#2c30a5", badgeColor: "#1a1d75", cellColor: "#f2f2fb", cellBorderColor: "#5156d6", buttonColor: "#cfd0f7" },
  { primary: "#2d4ea9", badgeColor: "#1b3479", cellColor: "#f2f4fb", cellBorderColor: "#5175d6", buttonColor: "#cfdaf7" },
  { primary: "#369bc9", badgeColor: "#22749b", cellColor: "#f2f8fb", cellBorderColor: "#51acd6", buttonColor: "#cfeaf7" },
  { primary: "#4ed0c5", badgeColor: "#27b4a8", cellColor: "#f3fbfb", cellBorderColor: "#51d6cb", buttonColor: "#cff7f4" },
  { primary: "#ba2135", badgeColor: "#871222", cellColor: "#fbf2f3", cellBorderColor: "#d65163", buttonColor: "#f7cfd4" },
  { primary: "#da9e2f", badgeColor: "#af7a18", cellColor: "#fbf7f2", cellBorderColor: "#d6a851", buttonColor: "#f7e9cf" },
];

// The fixtures name roles as plain strings, so this is the one place that has to reconcile them
// with the derived object — done with a lookup rather than a cast, so an unknown role is a test
// failure rather than a silent undefined.
function derived(primary: string, background?: string | null): ChromeColors {
  const chrome = chromeFromColor(primary, background);
  if (!chrome) throw new Error(`no palette derived for ${primary}`);
  return chrome;
}

function roleColor(chrome: ChromeColors, role: string): string {
  const value = Object.entries(chrome).find(([key]) => key === role)?.[1];
  if (value === undefined) throw new Error(`unknown role: ${role}`);
  return value;
}

describe("deriving a palette from one colour", () => {
  it("lands within a just-noticeable difference of hand-tuned palettes", () => {
    const measured = HAND_TUNED.flatMap(({ primary, ...want }) => {
      const got = chromeFromColor(primary);
      if (!got) throw new Error(`no palette derived for ${primary}`);
      return Object.entries(want).map(([role, hex]) => ({ primary, role, d: deltaE(hex, roleColor(got, role)) }));
    });
    const worst = [...measured].sort((a, b) => b.d - a.d)[0];
    expect(worst.d, `worst: ${worst.role} for ${worst.primary} (ΔE ${worst.d.toFixed(1)})`).toBeLessThan(MEASURED_WORST);
    // The median is what a reader actually sees across a grid, and it IS under the threshold.
    const sorted = measured.map((m) => m.d).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(2.3);
  });

  it("uses the brand colour itself for the header", () => {
    expect(chromeFromColor("#7c3aed")?.headerColor).toBe("#7c3aed");
  });

  // The one value that must never come from the file. On a dark brand colour the readable text is
  // white; on a light one it is near-black — and an author cannot know which surface a tool paints.
  it("derives readable text rather than taking it from anywhere", () => {
    expect(chromeFromColor("#2c30a5")?.headerTextColor).toBe("#ffffff");
    expect(chromeFromColor("#fbc02d")?.headerTextColor).toBe("#1b2430");
  });

  // The classic YIQ shortcut scores this just under its threshold and picks white, at 1.37:1.
  it("gets vivid green right, where the YIQ approximation does not", () => {
    expect(chromeFromColor("#00ff00")?.headerTextColor).toBe("#1b2430");
  });

  // The near-black is a preference, not the answer: it is 3.68:1 on this red where pure black is
  // 4.94:1, so a mid-tone brand colour that looks like it wants softening is exactly the one that
  // cannot afford it (Codex on #1592).
  it("drops the softening rather than the contrast on a mid-tone background", () => {
    expect(chromeFromColor("#e8341c")?.headerTextColor).toBe("#000000");
    expect(chromeFromColor("#808080")?.headerTextColor).toBe("#000000");
  });

  // The guarantee, measured rather than sampled by hand: every background in a coarse sweep of the
  // colour space gets an ink that clears AA for normal text. Three examples cannot say this, and
  // the ink is chosen by a rule with a branch in it — this is the assertion that branch answers to.
  it("never derives an ink below WCAG AA (4.5:1) for any background", () => {
    const STEP = 17; // 16^3 = 4096 backgrounds, coarse enough to stay fast and fine enough to hit the mid-tones
    const channels = Array.from({ length: 16 }, (_, i) => i * STEP);
    let worst = { background: "", ink: "", ratio: Infinity };
    channels.forEach((r) =>
      channels.forEach((g) =>
        channels.forEach((b) => {
          const background = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const ink = chromeFromColor(background)?.headerTextColor ?? "";
          const luminance = (hex: string): number => {
            const rgb = parseHex(hex);
            if (!rgb) throw new Error(`not a colour: ${hex}`);
            return relativeLuminance(rgb[0], rgb[1], rgb[2]);
          };
          const ratio = contrastRatio(luminance(background), luminance(ink));
          if (ratio < worst.ratio) worst = { background, ink, ratio };
        }),
      ),
    );
    expect(worst.ratio, `${worst.ink} on ${worst.background}`).toBeGreaterThanOrEqual(4.5);
  });

  it("takes `background` as the cell surface when the file gives one", () => {
    expect(derived("#7c3aed", "#0b1020").cellColor).toBe("#0b1020");
    expect(derived("#7c3aed").cellColor).not.toBe("#0b1020");
  });

  // Codex on #1445. An unusable `background` used to win the branch, survive as a non-colour and
  // be dropped further down — leaving NO surface, neither declared nor derived. A role that did
  // not parse is a role that was not declared, and the spec says `primary` alone must suffice.
  it.each(["blue", "rgb(1,2,3)", "#12345", "", "   "])("ignores an unusable background (%s) and still derives one", (background) => {
    const chrome = derived("#7c3aed", background);
    expect(chrome.cellColor).toBe(derived("#7c3aed").cellColor);
    expect(chrome.cellColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives the border and the idle dot the same colour", () => {
    const chrome = chromeFromColor("#369bc9");
    expect(chrome?.cellBorderColor).toBe(chrome?.dotColor);
  });

  it("produces #rrggbb for every role, whatever the input shape", () => {
    const chrome = derived("#F7C");
    Object.values(chrome).forEach((hex) => expect(hex).toMatch(/^#[0-9a-f]{6}$/));
  });
});

describe("what counts as a colour", () => {
  // `#rgb` and `#rrggbb` only — accepting more here would render files another conforming tool
  // rejects, which is the drift a shared specification exists to prevent.
  it("accepts the two forms the specification allows", () => {
    expect(parseHex("#7c3aed")).toEqual([124, 58, 237]);
    expect(parseHex("#F7C")).toEqual([255, 119, 204]);
    expect(normalizeHex("#F7C")).toBe("#ff77cc");
  });

  it.each(["rgb(1,2,3)", "rebeccapurple", "#12345", "#gggggg", "7c3aed", "", "  "])("refuses %s", (value) => {
    expect(parseHex(value)).toBeNull();
    expect(chromeFromColor(value)).toBeNull();
  });

  it("has no hue to move for a grey, and stays grey", () => {
    Object.values(derived("#808080"))
      // The derived text colour is one of two fixed inks, not a tint of the brand colour.
      .filter((hex) => hex !== "#1b2430" && hex !== "#ffffff")
      .forEach((hex) => {
        const rgb = parseHex(hex);
        if (!rgb) throw new Error(`not a colour: ${hex}`);
        expect(rgb[0] === rgb[1] && rgb[1] === rgb[2], `${hex} should be grey`).toBe(true);
      });
  });
});
