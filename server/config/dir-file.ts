// The one rule for "a file a DIRECTORY's own config named": relative to that directory, and
// provably inside it.
//
// A `.mulmoterminal.json` is written by whoever owns the project, and this server reads it and
// then reads the file it points at — so an opened project must not be able to aim that read at
// anything outside its own tree. Two keys already need exactly this (`sound`, `icon`), and the
// second was written by copying the first; the copy is what this file exists to stop, because a
// containment rule that is fixed on one side and not the other is not a containment rule.
import { existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { isWithin } from "../infra/path-within.js";

/** The absolute path `ref` names under `cwd`, or null when it is not a real file inside it.
 *
 *  Four checks, in this order and all four required: relative only (an absolute path names
 *  someone else's disk), lexically contained (no escaping via `..`), a file that exists (a
 *  directory or a device is not a config value), and contained AGAIN after realpath — the
 *  lexical check only constrains the path string, so a symlink sitting inside the directory
 *  and pointing out of it would otherwise pass. */
export function resolveFileWithinDir(cwd: string, ref: string): string | null {
  if (path.isAbsolute(ref)) return null;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, ref);
  if (!isWithin(base, resolved)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  try {
    // .native for the 8.3 reason in files/pathContainment.ts — one spelling of a Windows path.
    if (!isWithin(realpathSync.native(base), realpathSync.native(resolved))) return null;
  } catch {
    return null;
  }
  return resolved;
}
