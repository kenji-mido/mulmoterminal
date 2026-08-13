// Move a `#rrggbb` colour around the hue wheel, leaving saturation and lightness alone.
//
// Hue only, because those other two carry the contrast a colour was chosen for: a worktree
// tinted by lightness would drift towards its own background or its own text. Rotation keeps
// "same weight, different colour", which is what makes a row of worktrees read as a gradient
// rather than as a set of unrelated projects.

type Rgb = { r: number; g: number; b: number }; // channels 0..1
type Hsl = { h: number; s: number; l: number }; // h in degrees, s/l 0..1

const HEX_RE = /^#([0-9a-fA-F]{6})$/;
const DEGREES_PER_TURN = 360;
const SECTOR_DEGREES = 60;

const wrapDegrees = (degrees: number): number => ((degrees % DEGREES_PER_TURN) + DEGREES_PER_TURN) % DEGREES_PER_TURN;

function hexToRgb(hex: string): Rgb | null {
  const digits = HEX_RE.exec(hex)?.[1];
  if (digits === undefined) return null;
  const packed = Number.parseInt(digits, 16);
  return { r: ((packed >> 16) & 0xff) / 255, g: ((packed >> 8) & 0xff) / 255, b: (packed & 0xff) / 255 };
}

const channelHex = (value: number): string =>
  Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");

const rgbToHex = ({ r, g, b }: Rgb): string => `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;

// Which 60-degree sector of the wheel the max channel puts the colour in, in degrees.
function hueDegrees(rgb: Rgb, max: number, chroma: number): number {
  const { r, g, b } = rgb;
  if (max === r) return wrapDegrees(((g - b) / chroma) * SECTOR_DEGREES);
  if (max === g) return wrapDegrees(((b - r) / chroma + 2) * SECTOR_DEGREES);
  return wrapDegrees(((r - g) / chroma + 4) * SECTOR_DEGREES);
}

function rgbToHsl(rgb: Rgb): Hsl {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const l = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) return { h: 0, s: 0, l }; // grey: no hue to name, and the formula below divides by zero
  return { h: hueDegrees(rgb, max, chroma), s: chroma / (1 - Math.abs(2 * l - 1)), l };
}

function hslSector(turnSixths: number, chroma: number, second: number): [number, number, number] {
  if (turnSixths < 1) return [chroma, second, 0];
  if (turnSixths < 2) return [second, chroma, 0];
  if (turnSixths < 3) return [0, chroma, second];
  if (turnSixths < 4) return [0, second, chroma];
  if (turnSixths < 5) return [second, 0, chroma];
  return [chroma, 0, second];
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const turnSixths = h / SECTOR_DEGREES;
  const second = chroma * (1 - Math.abs((turnSixths % 2) - 1));
  const [r, g, b] = hslSector(turnSixths, chroma, second);
  const lift = l - chroma / 2;
  return { r: r + lift, g: g + lift, b: b + lift };
}

/** `hex` rotated `degrees` around the hue wheel, as `#rrggbb`.
 *
 *  Anything that isn't a `#rrggbb` colour, and any grey (white and black included), comes back
 *  exactly as it went in — a grey has no hue to move, and round-tripping it through HSL would
 *  only cost rounding. That is what lets a config's `headerTextColor: "#ffffff"` survive a tint
 *  without the caller having to special-case it. */
export function rotateHue(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  if (hsl.s === 0) return hex;
  return rgbToHex(hslToRgb({ ...hsl, h: wrapDegrees(hsl.h + degrees) }));
}
