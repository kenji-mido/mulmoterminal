// What a cell header is painted with while a session is working / done / blocked, and who decides.
//
// A header has two layers that were designed together and can drift apart: the DIRECTORY's colour
// (`headerColor` plus its ink) and the STATUS wash the theme mixes over it. #1591 is what the drift
// looks like — a `headerTextColor` chosen against a dark purple, still applied while a light theme
// paints the pale `--bg-selected` a running session gets: white on #d6e4fb, measured at 1.15:1 off
// the reporter's own screenshot.
//
// So both layers are resolved HERE, once, and every caller asks rather than combining the pieces
// itself. That is also what lets a directory recolour a status: the same function answers "what
// shows now", whether the answer came from the theme or from a config file.
//
// `idle` is deliberately not a configurable status. `headerColor` / `headerTextColor` ARE the idle
// state, and a second way to say the same thing is how one directory ends up written in two
// different colours.
import { headerTextColorFor } from "./chromeFromColor.js";
import { isHexColor } from "./hexColor.js";
import { isRecord } from "./isRecord.js";

/** The states whose header background the theme replaces, and which a config may therefore claim. */
export const HEADER_STATUS_KEYS = ["working", "done", "blocked"] as const;
export type HeaderStatusKey = (typeof HEADER_STATUS_KEYS)[number];

/** Every state a header paints — the three above plus the directory's own. */
export type HeaderPaintStatus = HeaderStatusKey | "idle";

export interface HeaderStatusColor {
  background: string | null;
  /** Omitted derives an AA ink from `background`. Naming it without a background is honoured
   *  as-is: that is a statement about a wash the author can see, unlike `headerTextColor`, which
   *  is a statement about the directory's own colour and is what #1591 misapplied. */
  text: string | null;
}

export type HeaderStatusColors = Partial<Record<HeaderStatusKey, HeaderStatusColor>>;

/** `background`: the theme washes the header while a session works (today's behaviour).
 *  `none`: the directory's own `headerColor` stays, and the status reads from the cell border,
 *  the dot and the status pill instead. */
export const HEADER_STATUS_TINTS = ["background", "none"] as const;
export type HeaderStatusTint = (typeof HEADER_STATUS_TINTS)[number];
export const DEFAULT_HEADER_STATUS_TINT: HeaderStatusTint = "background";

// `none` says "keep my palette", and `blocked` is the one state where nothing proceeds until the
// user answers. A switch aimed at colour consistency taking the amber off THAT is an accident, so
// it doesn't reach it — a directory that wants a different blocked colour says so outright with a
// `headerStatusColors.blocked` entry, which is honoured below.
const TINT_NONE_APPLIES_TO: readonly HeaderStatusKey[] = ["working", "done"];

/** What a header paints in one state. `null` means "the theme decides" — the caller emits no
 *  custom property and the theme's own wash / ink shows through the CSS fallback. */
export interface HeaderPaint {
  background: string | null;
  text: string | null;
}

const NOTHING: HeaderPaint = { background: null, text: null };

export interface HeaderChrome {
  headerColor: string | null;
  headerTextColor: string | null;
  // Both nullable so "nothing configured" is expressible without every caller spreading a default
  // in first — the shape a DirChrome already carries.
  statusColors: HeaderStatusColors | null;
  tint: HeaderStatusTint | null;
}

// A hex background always yields a readable ink, so `background` set and `text` unset cannot
// produce an unreadable header — the point of letting a config name one colour.
function paintFor(background: string | null, text: string | null): HeaderPaint {
  if (isHexColor(text)) return { background: isHexColor(background) ? background : null, text };
  if (isHexColor(background)) return { background, text: headerTextColorFor(background) };
  return NOTHING;
}

export function resolveHeaderPaint(status: HeaderPaintStatus, chrome: HeaderChrome): HeaderPaint {
  if (status === "idle") return paintFor(chrome.headerColor, chrome.headerTextColor);
  const declared = chrome.statusColors?.[status];
  if (declared && (isHexColor(declared.background) || isHexColor(declared.text))) return paintFor(declared.background, declared.text);
  // `none` means "keep the colour I chose", so it needs a colour to keep. A directory with a
  // `headerTextColor` and no usable `headerColor` has nothing for the ink to have been chosen
  // against — carrying the ink alone would leave it on the theme's wash, which is the bug this
  // whole file exists to stop (Codex review on #1619).
  const keepsDirectoryColour = chrome.tint === "none" && TINT_NONE_APPLIES_TO.includes(status) && isHexColor(chrome.headerColor);
  return keepsDirectoryColour ? paintFor(chrome.headerColor, chrome.headerTextColor) : NOTHING;
}

// ---- config parsing -------------------------------------------------------------------------

const oneEntry = (input: unknown): HeaderStatusColor | null => {
  if (isHexColor(input)) return { background: input, text: null };
  if (!isRecord(input)) return null;
  const background = isHexColor(input.background) ? input.background : null;
  const text = isHexColor(input.text) ? input.text : null;
  return background || text ? { background, text } : null;
};

/** Per status, so one bad entry can't discard the two that are right. A bare hex string is
 *  accepted for a status as shorthand for `{ background: … }` — the common case is one colour. */
export function sanitizeHeaderStatusColors(input: unknown): HeaderStatusColors {
  if (!isRecord(input)) return {};
  const out: HeaderStatusColors = {};
  for (const key of HEADER_STATUS_KEYS) {
    const entry = oneEntry(input[key]);
    if (entry) out[key] = entry;
  }
  return out;
}

/** `null` for anything that isn't one of the two modes, which is what "unset here" has to look
 *  like: a directory that says nothing must fall through to the global default rather than
 *  asserting the built-in one over it. */
export function sanitizeHeaderStatusTint(input: unknown): HeaderStatusTint | null {
  return HEADER_STATUS_TINTS.find((mode) => mode === input) ?? null;
}

/** The directory's answer, else the global one. WHOLE-key, not a per-status merge: the same rule
 *  `mergedDirConfigRaw` states for the three config files, and for its reason — a block a reader
 *  has to assemble from two places is harder to predict than one they can see entire. */
export function mergeHeaderStatusColors(global: HeaderStatusColors | null, dir: HeaderStatusColors | null): HeaderStatusColors | null {
  return dir && Object.keys(dir).length > 0 ? dir : global;
}
