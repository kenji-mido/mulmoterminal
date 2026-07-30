import { isHexColor } from "./hexColor";
import type { DirChrome } from "../../common/dirChrome";

// Which of a directory's configured colours represents it on a launch chip. A chip is too
// small to carry more than one, so it takes whichever the grid makes most visible, in that
// order: the cell header's background, then the name badge, then the cell body, then the
// idle status dot. A directory that configured none stays uncoloured.
export function dirChipColor(chrome: Pick<DirChrome, "headerColor" | "badgeColor" | "cellColor" | "dotColor">): string | null {
  return [chrome.headerColor, chrome.badgeColor, chrome.cellColor, chrome.dotColor].find(isHexColor) ?? null;
}

// A launch chip carries two INDEPENDENT facts — which directory it is, and whether a session is
// already running there — so they must not share a visual channel.
//
// They did. The directory washed the chip's background and warmed its border at 14% / 55%, and
// the running state used a blue wash and border at exactly 14% / 55%. That read correctly only
// while few directories were colour-coded: "tinted" meant "running". Once several were coloured
// (which #1103's mulmoterminal-dirs skill made a one-step job) a tint meant nothing, and a
// directory whose colour was blue-ish read as running while idle (#1106).
//
// The split, one meaning per channel:
//   hue on the leading stripe          -> WHICH directory
//   background + border + the pulse    -> RUNNING
//
// So an idle chip has no background whatever its colour, and the stripe is the only place a
// directory's colour appears. Kept as whole literal class strings rather than composed from a
// colour constant because Tailwind scans source text: an interpolated value produces no utility.
export const CHIP_IDLE = "border-border bg-elevated";
export const CHIP_RUNNING = "border-[color-mix(in_srgb,#3b82f6_55%,var(--border))] bg-[color-mix(in_srgb,#3b82f6_14%,var(--bg-elevated))]";

// The pulse is what survives a blue directory colour: nothing else in the chip list moves, and
// motion is the one channel a hue cannot imitate. `motion-reduce` drops it — the background,
// border and dot still say "running", so the signal is deliberately redundant rather than
// resting on animation alone.
export const CHIP_DOT_RUNNING = "bg-[#3b82f6] animate-cell-pulse motion-reduce:animate-none";
