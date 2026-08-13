// Where an edit goes when something is about to replace it. The Files editor saves on the
// user's behalf, and the agent running in that same directory writes the same files, so every
// discard here happens to content nobody explicitly threw away.
//
// Outside the project on purpose: a `.bak` beside the file shows up in `git status` and in the
// agent's view of its own repo, where it gets tidied up or committed.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { byCodeUnit } from "../../common/byCodeUnit.js";

/** Newest-first; older ones are dropped. Three is enough to reach past "opened it again",
 *  which is what rotates the oldest out. */
export const BACKUP_GENERATIONS = 3;

/** Names the directory a file's backups live in. A hash rather than the path itself: path
 *  separators, case-folding and length limits all make a real path an unusable directory name,
 *  and the mapping only has to be stable, not readable — `source.txt` carries the readable half. */
export function backupDirFor(absFile: string, root: string): string {
  return path.join(root, createHash("sha256").update(path.resolve(absFile)).digest("hex").slice(0, 16));
}

/** Which of `names` to delete, newest-first ordering assumed to come from the names themselves
 *  (they lead with a zero-padded timestamp). Split out so the retention rule is testable without
 *  a filesystem. */
export function expiredBackups(names: string[], keep = BACKUP_GENERATIONS): string[] {
  return names
    .filter((n) => n.endsWith(BACKUP_SUFFIX))
    .sort(byCodeUnit)
    .reverse()
    .slice(keep);
}

const BACKUP_SUFFIX = ".bak";
const SOURCE_FILE = "source.txt";
// Zero-padded so lexical order IS chronological order — the only ordering a directory listing
// can be trusted to give back.
const stamp = (at: number): string => String(at).padStart(15, "0");

// Two backups inside one millisecond are not hypothetical once saving happens on the user's
// behalf, and a bare timestamp would have the second silently replace the first — losing a
// generation exactly when churn makes them worth having. The counter breaks the tie within a
// process and keeps sorting chronological; the existence check covers a second process
// landing on the same millisecond and counter.
let sequence = 0;
const SEQUENCE_WIDTH = 3;
const SEQUENCE_WRAP = 1000;

function freeBackupPath(dir: string, absFile: string, at: number): string {
  const base = path.basename(absFile);
  for (;;) {
    sequence = (sequence + 1) % SEQUENCE_WRAP;
    const target = path.join(dir, `${stamp(at)}-${String(sequence).padStart(SEQUENCE_WIDTH, "0")}-${base}${BACKUP_SUFFIX}`);
    if (!fs.existsSync(target)) return target;
  }
}

function newestBackup(dir: string): string | null {
  try {
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(BACKUP_SUFFIX))
      .sort(byCodeUnit);
    const newest = names[names.length - 1];
    return newest === undefined ? null : path.join(dir, newest);
  } catch {
    return null;
  }
}

/** Store `text` as the newest generation for `absFile`, dropping the oldest beyond the limit.
 *  Returns the file written, or null when it was skipped or failed — callers must not let a
 *  backup problem fail the operation the user actually asked for. */
export function storeBackup(absFile: string, text: string, root: string, at: number = Date.now()): string | null {
  try {
    const dir = backupDirFor(absFile, root);
    fs.mkdirSync(dir, { recursive: true });
    // Re-opening a file must not rotate three identical copies in and push the real history out.
    const newest = newestBackup(dir);
    if (newest !== null && fs.readFileSync(newest, "utf8") === text) return null;

    const target = freeBackupPath(dir, absFile, at);
    fs.writeFileSync(target, text, "utf8");
    // The hash tells nobody which file this was; written once so the store stays inspectable.
    const source = path.join(dir, SOURCE_FILE);
    if (!fs.existsSync(source)) fs.writeFileSync(source, path.resolve(absFile), "utf8");

    expiredBackups(fs.readdirSync(dir)).forEach((name) => fs.rmSync(path.join(dir, name), { force: true }));
    return target;
  } catch {
    return null; // best-effort by design (see the module comment)
  }
}

/** Store what is on disk right now — the "about to be replaced" snapshot. A file that isn't
 *  there yet has nothing to lose. */
export function backupCurrentFile(absFile: string, root: string, at: number = Date.now()): string | null {
  try {
    return storeBackup(absFile, fs.readFileSync(absFile, "utf8"), root, at);
  } catch {
    return null;
  }
}
