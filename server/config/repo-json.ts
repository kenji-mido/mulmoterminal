// `repo.json` as MulmoTerminal settings (#1442).
//
// The open file sits UNDER this app's own two: `repo.json` → `.mulmoterminal.json` →
// `.mulmoterminal.local.json`, general to specific. It is not a replacement for them — it is what
// a repository can say to every tool, and what this one falls back on when nothing more specific
// exists.
//
// The output is a raw object in the same shape `.mulmoterminal.json` has, so it joins the existing
// merge and goes through the existing validation. Nothing here decides whether a colour is legal
// or a path is allowed; those rules stay written once, where they already are.
import path from "node:path";
import { existsSync } from "node:fs";
import { readJsonFile } from "../infra/read-text-file.js";
import { parseRepoJson, type RepoIcon } from "../../common/repoJson.js";
import { chromeFromColor } from "../../common/chromeFromColor.js";
import { isRemoteDirIconUrl } from "../../common/dirIcon.js";
import { resolveIconFile } from "./dir-icon.js";

export const REPO_JSON_FILE = "repo.json";

/** The `extensions` key this app answers to. Also the name a project writes in its own file. */
export const REPO_JSON_OWNER = "mulmoterminal";

/** `repo.json` turned into `.mulmoterminal.json`-shaped keys, or `{}` when there is nothing to say.
 *
 *  Two layers come out of the one file, and the order matters: the core fields (`name`, `icon`,
 *  `color`) are the general statement, and `extensions.mulmoterminal` is this app's own more
 *  specific one, so it goes on top. Both still sit below `.mulmoterminal.json`. */
export function repoJsonConfig(base: string): Record<string, unknown> {
  const file = path.join(base, REPO_JSON_FILE);
  const raw = tryRead(file);
  if (raw === null) return {};
  const meta = parseRepoJson(raw, REPO_JSON_OWNER);
  const core: Record<string, unknown> = {};
  if (meta.name) core.name = meta.name;
  const icon = pickIcon(base, meta.icons);
  if (icon) core.icon = icon;
  Object.assign(core, chromeKeys(meta.colors.primary, meta.colors.background));
  // The extension wins over what the core implied — it is the same file being more specific about
  // this one consumer. `.mulmoterminal.json` still outranks both.
  return { ...core, ...(meta.extension ?? {}) };
}

/** Whether a directory carries the open file at all — for the settings preview, which names it. */
export const repoJsonPath = (base: string): string | null => {
  try {
    const file = path.join(path.resolve(base), REPO_JSON_FILE);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
};

function tryRead(file: string): unknown {
  try {
    return existsSync(file) ? readJsonFile(file) : null;
  } catch {
    return null;
  }
}

// Ranked best-first already; take the first that RESOLVES, not the first that exists. A dead entry
// must not bury the working ones behind it — the rule the specification states and #1429 proved.
//
// Returns the `src` as written rather than a resolved path: the caller feeds it back through the
// same `icon` field the config file uses, so the containment rules apply once, in one place.
function pickIcon(base: string, icons: RepoIcon[]): string | null {
  for (const { src } of icons) {
    if (isRemoteDirIconUrl(src)) return src;
    if (resolveIconFile(base, src)) return src;
  }
  return null;
}

// A repository declares one brand colour; a cell is painted with seven. Absent when the file gives
// no usable colour — an unreadable value must not blank out the palette, it must leave it alone.
function chromeKeys(primary: string | null, background: string | null): Record<string, unknown> {
  if (!primary) return {};
  const chrome = chromeFromColor(primary, background);
  return chrome ? { ...chrome } : {};
}
