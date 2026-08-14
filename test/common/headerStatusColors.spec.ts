// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  HEADER_STATUS_KEYS,
  DEFAULT_HEADER_STATUS_TINT,
  resolveHeaderPaint,
  sanitizeHeaderStatusColors,
  sanitizeHeaderStatusTint,
  mergeHeaderStatusColors,
  type HeaderChrome,
} from "../../common/headerStatusColors.js";
import { parseHex } from "../../common/chromeFromColor.js";
import { contrastRatio, relativeLuminance } from "../../common/contrast.js";

const chrome = (over: Partial<HeaderChrome> = {}): HeaderChrome => ({
  headerColor: null,
  headerTextColor: null,
  statusColors: null,
  tint: null,
  ...over,
});

// WCAG AA for normal text — the bar chromeFromColor.ts picks its inks against.
const AA_CONTRAST = 4.5;

const ratio = (background: string, text: string): number => {
  const [bg, fg] = [parseHex(background), parseHex(text)];
  if (!bg || !fg) throw new Error(`not a colour: ${background} / ${text}`);
  return contrastRatio(relativeLuminance(...bg), relativeLuminance(...fg));
};

describe("resolveHeaderPaint", () => {
  it("paints the directory's colour and ink while idle", () => {
    expect(resolveHeaderPaint("idle", chrome({ headerColor: "#8e44ad", headerTextColor: "#ffe8a3" }))).toEqual({ background: "#8e44ad", text: "#ffe8a3" });
  });

  it("derives the idle ink when the directory declared none", () => {
    expect(resolveHeaderPaint("idle", chrome({ headerColor: "#8e44ad" }))).toEqual({ background: "#8e44ad", text: "#ffffff" });
  });

  // The whole of #1591: the theme replaces the background in these three states, so an ink chosen
  // against `headerColor` describes a colour that is no longer on screen. Answering "the theme
  // decides" for BOTH is what keeps the pair the theme designed together.
  it("defers to the theme in every state whose background the theme replaces", () => {
    const declared = chrome({ headerColor: "#8e44ad", headerTextColor: "#ffffff" });
    for (const status of HEADER_STATUS_KEYS) {
      expect(resolveHeaderPaint(status, declared)).toEqual({ background: null, text: null });
    }
  });

  it("uses a configured colour for the status that names one, and only that one", () => {
    const configured = chrome({ headerColor: "#8e44ad", statusColors: { done: { background: "#166534", text: null } } });
    expect(resolveHeaderPaint("done", configured)).toEqual({ background: "#166534", text: "#ffffff" });
    expect(resolveHeaderPaint("working", configured)).toEqual({ background: null, text: null });
  });

  it("keeps a text-only entry exactly as written", () => {
    const inkOnly = chrome({ statusColors: { working: { background: null, text: "#ffe8a3" } } });
    expect(resolveHeaderPaint("working", inkOnly)).toEqual({ background: null, text: "#ffe8a3" });
  });

  it("keeps the directory's colour in working / done when the tint is off", () => {
    const noTint = chrome({ headerColor: "#8e44ad", tint: "none" });
    expect(resolveHeaderPaint("working", noTint)).toEqual({ background: "#8e44ad", text: "#ffffff" });
    expect(resolveHeaderPaint("done", noTint)).toEqual({ background: "#8e44ad", text: "#ffffff" });
  });

  // `none` is a statement about palette consistency. `blocked` is the state where nothing proceeds
  // until the user answers, so it keeps the theme's amber unless a config names another colour for
  // it outright — which is a decision rather than a side effect.
  it("does not let the tint switch take the amber off a blocked cell", () => {
    expect(resolveHeaderPaint("blocked", chrome({ headerColor: "#8e44ad", tint: "none" }))).toEqual({ background: null, text: null });
    expect(resolveHeaderPaint("blocked", chrome({ tint: "none", statusColors: { blocked: { background: "#7c2d12", text: null } } }))).toEqual({
      background: "#7c2d12",
      text: "#ffffff",
    });
  });

  // `none` keeps the colour the ink was chosen against. With no usable `headerColor` there is no
  // such colour, and carrying the ink alone would put it on the theme's wash — this file's own bug,
  // re-entered through the switch meant to avoid it (Codex review on #1619).
  it("keeps nothing when the tint is off and there is no directory colour to keep", () => {
    expect(resolveHeaderPaint("working", chrome({ headerTextColor: "#ffffff", tint: "none" }))).toEqual({ background: null, text: null });
    expect(resolveHeaderPaint("working", chrome({ headerColor: "not-a-colour", headerTextColor: "#ffffff", tint: "none" }))).toEqual({
      background: null,
      text: null,
    });
    // Idle is unaffected: there the ink sits on the theme's own panel, which is what it always did.
    expect(resolveHeaderPaint("idle", chrome({ headerTextColor: "#ffffff" }))).toEqual({ background: null, text: "#ffffff" });
  });

  it("treats a non-hex background as unconfigured rather than passing it to a style", () => {
    expect(resolveHeaderPaint("working", chrome({ statusColors: { working: { background: "red", text: null } } }))).toEqual({ background: null, text: null });
  });

  // The reason a config may name one colour: the derived ink is computed, so the pair cannot come
  // out unreadable. Swept across the hue wheel rather than over colours chosen by hand — the ones
  // anybody would think to write are the ones already believed to be fine.
  it("derives an ink that meets WCAG AA on every background it is given", () => {
    const worst = { background: "", ratio: Infinity };
    for (let hue = 0; hue < 360; hue += 5) {
      for (const lightness of [0.12, 0.28, 0.45, 0.58, 0.72, 0.88]) {
        const background = hslHex(hue / 360, 0.62, lightness);
        const paint = resolveHeaderPaint("working", chrome({ statusColors: { working: { background, text: null } } }));
        if (!paint.text) throw new Error(`no ink derived for ${background}`);
        const measured = ratio(background, paint.text);
        if (measured < worst.ratio) Object.assign(worst, { background, ratio: measured });
      }
    }
    // 432 backgrounds. The message names the worst one, so a regression says WHICH colour broke
    // rather than only that something did.
    expect(worst.ratio, `worst background: ${worst.background}`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

describe("sanitizeHeaderStatusColors", () => {
  it("accepts a bare hex as the background, and an object with either colour", () => {
    expect(sanitizeHeaderStatusColors({ working: "#6d28d9", done: { background: "#166534" }, blocked: { text: "#ffe8a3" } })).toEqual({
      working: { background: "#6d28d9", text: null },
      done: { background: "#166534", text: null },
      blocked: { background: null, text: "#ffe8a3" },
    });
  });

  it("drops one bad status without discarding the others", () => {
    expect(sanitizeHeaderStatusColors({ working: "rgb(1,2,3)", done: "#166534" })).toEqual({ done: { background: "#166534", text: null } });
  });

  it("ignores a status it does not paint, and anything that is not an object", () => {
    expect(sanitizeHeaderStatusColors({ idle: "#166534" })).toEqual({});
    expect(sanitizeHeaderStatusColors(["#166534"])).toEqual({});
    expect(sanitizeHeaderStatusColors(null)).toEqual({});
  });
});

describe("sanitizeHeaderStatusTint", () => {
  it("keeps the two modes and answers null for everything else", () => {
    expect(sanitizeHeaderStatusTint("none")).toBe("none");
    expect(sanitizeHeaderStatusTint(DEFAULT_HEADER_STATUS_TINT)).toBe(DEFAULT_HEADER_STATUS_TINT);
    // null, not the default: "this directory said nothing" has to stay distinguishable from
    // "this directory asked for the built-in", or a directory could never inherit the global one.
    expect(sanitizeHeaderStatusTint("off")).toBeNull();
    expect(sanitizeHeaderStatusTint(undefined)).toBeNull();
  });
});

describe("mergeHeaderStatusColors", () => {
  const global = { working: { background: "#6d28d9", text: null } };
  const dir = { done: { background: "#166534", text: null } };

  it("replaces the global block whole when the directory names one", () => {
    expect(mergeHeaderStatusColors(global, dir)).toEqual(dir);
  });

  it("falls through to the global one when the directory says nothing", () => {
    expect(mergeHeaderStatusColors(global, null)).toEqual(global);
    expect(mergeHeaderStatusColors(global, {})).toEqual(global);
  });
});

// A hex from HSL, so the sweep above walks the wheel rather than a list someone chose.
function hslHex(h: number, s: number, l: number): string {
  const channel = (t: number): number => {
    const shifted = ((t % 1) + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };
  return `#${[channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
