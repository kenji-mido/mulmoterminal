// Finding a project's icon when its `.mulmoterminal.json` names none (#1428): the repository
// usually already has one, because it is a web project and a web project has a favicon.
//
// The search list is not a guess. Scanning 157 git repositories on the author's machine, 26 had
// a detectable icon and EVERY ONE of them kept it under `public/` — `public/favicon.ico` (22),
// `apple-touch-icon.png` (6), a web manifest (5), `public/favicon.svg` (3). Nothing at the
// repository root, and nothing in `docs/` or `assets/`. So `public/` leads, the root is checked
// after it as a convention that costs one stat, and `docs/logo.png` is deliberately absent: a
// "logo" is often a wide README banner, which is not an icon.
//
// Everything found here goes through resolveIconFile, the SAME confinement the written key uses.
// The search must not become a second way into the filesystem — it only decides WHICH relative
// path to offer, never whether that path is allowed.
import { existsSync } from "node:fs";
import path from "node:path";
import { readJsonFile } from "../infra/read-text-file.js";
import { isRecord } from "../../common/isRecord.js";
import { isUnknownArray } from "../../common/isUnknownArray.js";
import { resolveIconFile, type DirIcon } from "./dir-icon.js";
import { largestIconArea } from "../../common/iconSizes.js";

// Ordered by how well the image survives being drawn at 14px, not by how common it is: an SVG is
// exact at any size, an apple-touch icon is ~180px of real artwork, and a .ico is often a 16px
// bitmap. `public/` before the root within each pair, since that is where they actually live.
const ICON_CANDIDATES = [
  "public/favicon.svg",
  "favicon.svg",
  "public/apple-touch-icon.png",
  "apple-touch-icon.png",
  "public/favicon.png",
  "favicon.png",
  "public/favicon.ico",
  "favicon.ico",
] as const;

// Read only when no plain file matched — this is the one candidate that costs a parse.
const MANIFEST_CANDIDATES = ["public/site.webmanifest", "public/manifest.json", "site.webmanifest", "manifest.json"] as const;

/** The icon a directory carries without saying so, or null when it has none. */
export function detectDirIcon(cwd: string): DirIcon | null {
  const base = path.resolve(cwd);
  // Keep going until one RESOLVES, not until one exists. A path can exist and still be unusable —
  // a directory named `favicon.svg`, or a symlink pointing out of the repository — and stopping
  // there would let one bad high-priority entry hide the good `favicon.png` behind it
  // (Codex + CodeRabbit on #1429). resolveIconFile does its own existence check, so this costs
  // nothing extra for the candidates that simply aren't there.
  for (const ref of ICON_CANDIDATES) {
    const icon = resolveIconFile(base, ref);
    if (icon) return icon;
  }
  return manifestIcon(base);
}

// existsSync on a path built from a CONSTANT — the candidate list — so this cannot be reached
// with a caller-supplied path. Used only to decide whether a manifest is worth PARSING; the
// candidates above go straight through resolveIconFile, which checks existence itself.
function fileExists(base: string, ref: string): boolean {
  try {
    return existsSync(path.join(base, ref));
  } catch {
    return false;
  }
}

function manifestIcon(base: string): DirIcon | null {
  for (const manifest of MANIFEST_CANDIDATES) {
    const icon = iconFromManifest(base, manifest);
    if (icon) return icon;
  }
  return null;
}

function iconFromManifest(base: string, manifestRef: string): DirIcon | null {
  const file = path.join(base, manifestRef);
  if (!fileExists(base, manifestRef)) return null;
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || !isUnknownArray(parsed.icons)) return null;
  // `src` is resolved against the MANIFEST's directory, not the project root: in the layout every
  // one of these repositories uses, the manifest sits in `public/` and its `/pwa-192.png` means
  // `public/pwa-192.png` — the web root is that directory, not the checkout.
  //
  // Joined with path.posix so the `ref` this produces is spelled the way the candidate list above
  // spells one — a `ref` is a config value (dir-icon.ts) and a config file is read on every
  // platform, so `public\big.png` would be a path only Windows resolves. path.resolve inside
  // resolveIconFile takes "/" on Windows, so nothing is lost by keeping it.
  const manifestDir = path.posix.dirname(manifestRef);
  for (const entry of rankedIcons(parsed.icons)) {
    const icon = resolveIconFile(base, path.posix.join(manifestDir, entry.src));
    if (icon) return icon;
  }
  return null;
}

type ManifestIcon = { src: string; area: number; maskable: boolean };

// Best first: a plain icon before a `maskable` one (which carries a safe-zone margin and reads as
// shrunken when drawn unmasked), then the largest declared size. An entry with no `sizes` sorts
// last rather than being dropped — it is still an icon, just an unranked one.
function rankedIcons(entries: readonly unknown[]): ManifestIcon[] {
  return entries
    .flatMap((entry) => (isRecord(entry) ? [entry] : []))
    .flatMap((entry) => {
      const src = typeof entry.src === "string" ? entry.src.trim() : "";
      // Relative only. A written `icon` may name an http(s) URL because the user typed it; a
      // manifest we went looking for must not make the browser fetch somebody's host uninvited.
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return [];
      const purpose = typeof entry.purpose === "string" ? entry.purpose : "";
      return [{ src, area: largestIconArea(entry.sizes), maskable: /\bmaskable\b/i.test(purpose) }];
    })
    .sort((a, b) => Number(a.maskable) - Number(b.maskable) || b.area - a.area);
}

function tryReadJson(file: string): unknown {
  try {
    return readJsonFile(file);
  } catch {
    return null;
  }
}
