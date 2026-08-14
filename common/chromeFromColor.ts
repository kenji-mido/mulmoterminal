// One brand colour to the seven chrome colours a cell is painted with (#1442).
//
// `repo.json` gives a project one colour; MulmoTerminal paints seven. Rather than ask a repository
// to describe this app's chrome, the other six are derived — and the derivation is measured, not
// invented. Against eleven hand-tuned palettes in this author's own projects, deriving from
// `primary` alone lands within ΔE76 2.5, median 1.9. The median is under 2.3, the threshold where a
// colour difference becomes noticeable at all; the worst single role sits just above it. One
// derived value came out byte-identical to the hand-picked one.
//
// The measurement's real finding is that ONE rule does not fit every role:
//
//   - the badge sits RELATIVE to the brand colour — a fixed darkening of whatever it is
//   - the surfaces sit at ABSOLUTE lightness, the same pale values whatever the brand colour is
//
// Snapping every role to absolute values drifts by ΔE 20 at the dark end of the hue wheel; making
// every role a relative offset drifts by ΔE 15 at the pale end. Both were tried; this is the mix
// that fits. Anyone retuning these numbers should re-measure rather than reason about them.
import { contrastRatio, readableTextColor, relativeLuminance } from "./contrast.js";

export interface ChromeColors {
  badgeColor: string;
  headerColor: string;
  headerTextColor: string;
  cellColor: string;
  cellBorderColor: string;
  dotColor: string;
  buttonColor: string;
}

// Saturation/lightness offsets FROM the brand colour.
const BADGE_OFFSET = { s: 0.061, l: -0.129 };
// Absolute saturation/lightness, at the brand colour's hue.
const SURFACE = { s: 0.53, l: 0.96 };
const EDGE = { s: 0.6, l: 0.58 };
const BUTTON = { s: 0.67, l: 0.89 };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// The inks a header background can be written in. Black is softened to a near-black so a pale
// header does not read as a printed page; white is left pure, since anything softer loses contrast
// on the dark end where it is chosen.
const DARK_INK = "#1b2430";
const PURE_DARK_INK = "#000000";
const LIGHT_INK = "#ffffff";

// WCAG AA for normal text. These chips run to 10px, so the large-text 3:1 bar does not apply.
const AA_CONTRAST = 4.5;
const DARK_INK_LUMINANCE = relativeLuminance(0x1b, 0x24, 0x30);

// The softening is a PREFERENCE, and it costs contrast: on a mid-tone background that cost is what
// drops the text below AA — `#e8341c` measures 3.68:1 against the softened ink and 4.94:1 against
// pure black (Codex on #1592, which is right and was worth measuring). So it is applied only while
// it is free. Falling back always works: at the worst background — the luminance where black and
// white are equally readable — the pure ink still reaches 4.58:1.
function inkFor(rgb: [number, number, number]): string {
  if (readableTextColor(rgb[0], rgb[1], rgb[2]) === "#fff") return LIGHT_INK;
  const background = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  return contrastRatio(background, DARK_INK_LUMINANCE) >= AA_CONTRAST ? DARK_INK : PURE_DARK_INK;
}

/** Which ink a header background wants, or null when it isn't a colour we can read. Exported so a
 *  directory that declares only `headerColor` derives the SAME text colour this file gives a
 *  repo.json brand colour (src/components/cellHeaderStyle.ts) — two answers to one question is how
 *  one directory ends up written in two different colours. */
export function headerTextColorFor(background: string): string | null {
  const rgb = parseHex(background);
  return rgb ? inkFor(rgb) : null;
}

/** The seven colours for a brand colour, or null when it isn't a colour we can read. */
export function chromeFromColor(primary: string, background?: string | null): ChromeColors | null {
  const rgb = parseHex(primary);
  if (!rgb) return null;
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  // A grey has no hue to move, so tinting it would INVENT one — every derived role would come out
  // red, since an achromatic colour reports hue 0. Keep an achromatic brand colour achromatic.
  const achromatic = saturation === 0;
  const at = (s: number, l: number): string => hslToHex(hue, achromatic ? 0 : clamp01(s), clamp01(l));
  return {
    badgeColor: at(saturation + BADGE_OFFSET.s, lightness + BADGE_OFFSET.l),
    headerColor: normalizeHex(primary),
    // Never taken from the file — see the spec's "text colour is never declared". Deriving it is
    // also what makes two conforming tools agree.
    headerTextColor: inkFor(rgb),
    // `background` is the surface the brand colour sits on, which is exactly what a cell body is.
    // Gated on it PARSING, not on it being present: an unusable value here used to win the branch,
    // survive as a non-colour, and then be dropped downstream — leaving no surface at all, neither
    // the declared one nor the derived one (Codex on #1445). The spec says a consumer must be able
    // to work from `primary` alone, and a role that didn't parse is a role that wasn't declared.
    cellColor: (background && parseHex(background) && normalizeHex(background)) || at(SURFACE.s, SURFACE.l),
    cellBorderColor: at(EDGE.s, EDGE.l),
    dotColor: at(EDGE.s, EDGE.l),
    buttonColor: at(BUTTON.s, BUTTON.l),
  };
}

// `#rgb` and `#rrggbb` — the two forms the specification allows, and nothing else. Accepting more
// here would mean this app renders files another conforming tool would reject.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim();
  if (!HEX_RE.test(hex)) return null;
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((c) => c + c).join("") : body;
  const channel = (i: number): number => parseInt(full.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** `#rgb` widened to `#rrggbb`, lowercased — the shape the rest of the config expects. */
export function normalizeHex(value: string): string {
  const rgb = parseHex(value);
  return rgb ? `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` : value.trim().toLowerCase();
}

// Which sixth of the wheel the colour sits in, given which channel is the largest.
function hueSextant(rn: number, gn: number, bn: number, max: number, delta: number): number {
  if (max === rn) return (gn - bn) / delta + (gn < bn ? 6 : 0);
  if (max === gn) return (bn - rn) / delta + 2;
  return (rn - gn) / delta + 4;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  return [hueSextant(rn, gn, bn, max, delta) / 6, saturation, lightness];
}

function hslToHex(h: number, s: number, l: number): string {
  const channel = (t: number): number => {
    const shifted = ((t % 1) + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };
  const rgb = s === 0 ? [l, l, l] : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
  return `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
