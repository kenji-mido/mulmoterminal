// Reading `repo.json`, the open repository-metadata format (docs/repo-json.md, #1442).
//
// This normalises the SHAPE the specification allows into one predictable form. Both of its fields
// with a shorthand — `icon` and `color` — follow the same rule:
//
//   Where a field has an obvious primary value, the scalar form is shorthand for the fullest form.
//
// Normalising at the boundary is what that rule buys: everything downstream sees one form, so the
// shorthand costs a single function rather than a branch at every use.
import { isRecord } from "./isRecord.js";
import { isUnknownArray } from "./isUnknownArray.js";
import { largestIconArea } from "./iconSizes.js";

/** One entry of `icon`, after the string shorthand has been expanded. */
export interface RepoIcon {
  src: string;
  /** Space-separated `<w>x<h>`, or `any` for a vector. Absent when the file didn't say. */
  sizes?: string;
}

export interface RepoColors {
  primary: string | null;
  accent: string | null;
  background: string | null;
}

export interface RepoMeta {
  name: string | null;
  /** Ranked best-first by the specification's rules; empty when the file names no usable icon. */
  icons: RepoIcon[];
  colors: RepoColors;
  /** `extensions.<name>` for one consumer, as a raw object — validated by whoever owns it. */
  extension: Record<string, unknown> | null;
}

export const EMPTY_REPO_META: RepoMeta = { name: null, icons: [], colors: { primary: null, accent: null, background: null }, extension: null };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Parse a `repo.json` body for one consumer. `owner` names the `extensions` entry to pick up. */
export function parseRepoJson(raw: unknown, owner: string): RepoMeta {
  if (!isRecord(raw)) return EMPTY_REPO_META;
  const extensions = isRecord(raw.extensions) ? raw.extensions : null;
  const mine = extensions && isRecord(extensions[owner]) ? extensions[owner] : null;
  return { name: str(raw.name), icons: parseIcons(raw.icon), colors: parseColors(raw.color), extension: mine };
}

// `"icon": "x.png"` means exactly `[{ "src": "x.png" }]` — stated in the spec so that an
// implementation can normalise once and never branch on the form again.
function parseIcons(input: unknown): RepoIcon[] {
  if (typeof input === "string") {
    const src = input.trim();
    return src ? [{ src }] : [];
  }
  if (!isUnknownArray(input)) return [];
  const entries = input.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const src = str(entry.src);
    if (!src) return [];
    const sizes = str(entry.sizes);
    return [sizes ? { src, sizes } : { src }];
  });
  return rankIcons(entries);
}

/** Best first: vector, then largest declared size, then the order the author wrote. */
export function rankIcons(icons: RepoIcon[]): RepoIcon[] {
  // Sorted with the index as the tie-break rather than relying on sort stability, so "the first
  // listed wins a tie" is a property of this function rather than of the engine.
  return icons
    .map((icon, index) => ({ icon, index, area: largestIconArea(icon.sizes) }))
    .sort((a, b) => b.area - a.area || a.index - b.index)
    .map((entry) => entry.icon);
}

// `"color": "#7c3aed"` means exactly `{ "primary": "#7c3aed" }` — the same shorthand rule as `icon`.
function parseColors(input: unknown): RepoColors {
  if (typeof input === "string") return { primary: str(input), accent: null, background: null };
  if (!isRecord(input)) return { primary: null, accent: null, background: null };
  return { primary: str(input.primary), accent: str(input.accent), background: str(input.background) };
}
