// What a new git worktree inherits from the project it was cut from (#1317).
//
// `.mulmoterminal.json` is normally gitignored, so `git worktree add` produces a directory with
// no config at all: the worktree's cell loses the project's colours, name, model and grid rank
// and lands last in the priority sort, looking like an unrelated project. This derives the
// worktree's own config from the parent's and writes it there.
//
// The input is a LOADED DirConfig, not the raw file. Every field of that has already been
// through the loader's zod validation, so what comes out here is valid by construction and
// needs no second pass — where re-parsing the raw JSON would have to restate the rules.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR_CONFIG_FILE, loadDirConfig, type DirConfig } from "./dir-config.js";
import { rotateHue } from "./hue-rotate.js";

// How far around the hue wheel each successive worktree sits from the one before it. Small
// enough that the whole family still reads as one project, wide enough to tell two cells apart
// at thumbnail size.
const HUE_STEP_DEGREES = 12;

// Adopted unchanged: what the project IS rather than which tree this is. `colors` (the xterm
// palette) is deliberately here and not tinted — rotating the terminal's own palette would move
// the ANSI colours a program's output names, which is a readability change, not a label.
const INHERITED_KEYS = ["name", "theme", "colors", "fontSize", "fontFamily", "provider", "model"] as const;

// The cell's chrome — everything a glance at the grid distinguishes one cell by. These get the
// tint, so a worktree is recognisable both AS this project and as not the project's main tree.
const TINTED_COLOR_KEYS = ["badgeColor", "headerColor", "headerTextColor", "cellColor", "cellBorderColor", "dotColor", "buttonColor"] as const;

// Deliberately absent: `sound` / `sounds` point at a file inside the parent directory that the
// worktree has no copy of, and `addDirs` resolves relative to the config's OWN directory — copied
// verbatim it would silently grant a different set of directories.

/** The worktree's rank in the grid's priority sort: one past its parent's, so it sits directly
 *  after the project it came from. Only when the parent declares one — inventing a rank for a
 *  project that set none would pull it ahead of every project that did. */
function worktreeRank(parentRank: number | null): number | null {
  if (parentRank === null) return null;
  const rank = parentRank + 1;
  return Number.isSafeInteger(rank) ? rank : null;
}

/** The `.mulmoterminal.json` contents for the `index`-th worktree of a project (1-based, so the
 *  first worktree is already one step off the parent's hue). Keys the parent doesn't set are
 *  left out rather than written as null, so the file reads like one a person would have typed. */
export function inheritedWorktreeConfig(parent: DirConfig, index: number): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  INHERITED_KEYS.forEach((key) => {
    const value = parent[key];
    if (value !== null) config[key] = value;
  });
  TINTED_COLOR_KEYS.forEach((key) => {
    const value = parent[key];
    if (value !== null) config[key] = rotateHue(value, index * HUE_STEP_DEGREES);
  });
  const rank = worktreeRank(parent.orderPriority);
  if (rank !== null) config.orderPriority = rank;
  return config;
}

/** Write the derived config into `worktreeDir`. Returns whether a file was written.
 *
 *  Writes nothing when the parent configures nothing this carries — an empty `{}` on disk is a
 *  file the settings preview would report as present and doing nothing. Never overwrites: a
 *  worktree that already has one either committed it to the repo or was set up by hand, and
 *  either way that file is the answer, not ours. */
export function writeInheritedDirConfig(parentDir: string, worktreeDir: string, index: number): boolean {
  const config = inheritedWorktreeConfig(loadDirConfig(parentDir), index);
  if (Object.keys(config).length === 0) return false;
  const file = path.join(worktreeDir, DIR_CONFIG_FILE);
  if (existsSync(file)) return false;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}
