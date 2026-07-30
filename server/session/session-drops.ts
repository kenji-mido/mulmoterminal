// Where a dropped file's bytes land when the browser withheld its path.
//
// Structured like session-settings.ts, and for the same reason: the files belong to one
// session, so reap() drops them, and a boot sweep drops what a crash never reached.
//
// The directory is what differs. os.tmpdir() is SHARED with every other program and user on
// the host, which drives two rules here — the tree is 0700, and the sweep only ever removes a
// directory whose name is a session id we could have minted. "The parent is ours" is not a
// good enough reason to delete something we did not write.
import { lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync, type Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { removeQuietly } from "../infra/fs-cleanup.js";
import { hasErrnoCode, messageOf } from "../errors.js";
import { SESSION_ID_RE } from "../config/env.js";
import { extensionForMime } from "../backends/remoteHost/attachment-path.js";

// One parent for every session's drops, so the sweep reads a directory of ours instead of
// walking the whole of tmp.
export const DROPS_ROOT = path.join(os.tmpdir(), "mulmoterminal-drops");

// tmp is world-readable by default, and a dropped file is whatever the user had open.
const PRIVATE_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

// A suffix taken from the client's filename. Alphanumeric and short: enough for `tsx` or
// `jpeg`, and nothing that could reshape a path or collide with the `.tmp` staging name.
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,16}$/;

/** The session's drop directory, or null when `sessionId` is not one we could have minted.
 *  Callers already hold an id from randomUUID() or a SESSION_ID_RE match; re-checking is what
 *  keeps a crafted id from naming a path outside DROPS_ROOT. */
export function dropsDir(sessionId: string): string | null {
  return SESSION_ID_RE.test(sessionId) ? path.join(DROPS_ROOT, sessionId) : null;
}

/** The extension a saved drop should carry.
 *
 *  The FILENAME is consulted before the MIME type because a browser's type for a source file
 *  is unreliable in a way that matters here: `.ts` is commonly reported as video/mp2t and most
 *  code files as an empty string, so a MIME-first rule renames the everyday case to `.bin` and
 *  the agent then reads a file whose type it cannot tell. Only the suffix is taken, and only
 *  when it is plainly a suffix — the name itself is never used (see saveDrop). */
export function dropExtension(filename: string | null, mimeType: string): string {
  const suffix = typeof filename === "string" ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  if (filename?.includes(".") && SAFE_EXTENSION.test(suffix)) return `.${suffix.toLowerCase()}`;
  return extensionForMime(mimeType);
}

/** Whether a directory is this user's alone.
 *
 *  It is `lstat` that is passed in, so a SYMLINK fails `isDirectory()` here instead of being
 *  followed to whatever it points at — which is the attack this exists for: on Linux
 *  `os.tmpdir()` is world-writable, so another user can pre-create our root as a link aimed at
 *  a directory of their choosing, and every dropped file would then be written where they
 *  decided rather than where we said.
 *
 *  Windows is exempt from the owner/mode half: its temp directory is per-user already, and Node
 *  does not implement `mode` there, so the check would assert the platform, not the code. */
function isPrivateToUs(stat: Stats): boolean {
  if (!stat.isDirectory()) return false;
  if (process.platform === "win32") return true;
  const uid = process.getuid?.();
  return (uid === undefined || stat.uid === uid) && (stat.mode & 0o077) === 0;
}

/** The drops root, created if missing and refused if it is not ours. Re-checked on every use
 *  rather than trusted for having been made by us once. */
function usableRoot(): string | null {
  try {
    // Deliberately NOT `recursive`: that silently accepts a directory that already exists, and
    // one that already exists is exactly the case that has to be inspected instead of assumed.
    mkdirSync(DROPS_ROOT, { mode: PRIVATE_MODE });
    return DROPS_ROOT;
  } catch (err) {
    if (!hasErrnoCode(err) || err.code !== "EEXIST") {
      console.warn(`[drops] could not create ${DROPS_ROOT}: ${messageOf(err)}`);
      return null;
    }
  }
  const stat = lstatSync(DROPS_ROOT, { throwIfNoEntry: false });
  if (stat && isPrivateToUs(stat)) return DROPS_ROOT;
  console.warn(`[drops] ${DROPS_ROOT} exists but is not a private directory of ours — dropped files will not be saved`);
  return null;
}

/** Create the session's drop directory and return its path, or null when it could not be
 *  prepared. Never throws: a spawn must not fail because a drop target is unavailable — the
 *  caller simply grants no extra directory, and drops fall back to the old hint. */
export function ensureDropsDir(sessionId: string): string | null {
  const dir = dropsDir(sessionId);
  if (!dir || !usableRoot()) return null;
  try {
    mkdirSync(dir, { mode: PRIVATE_MODE });
    return dir;
  } catch (err) {
    // Inside a root nobody else can write to, an existing session directory is one of ours from
    // an earlier attach — the reattach path comes back through here on every server restart.
    if (hasErrnoCode(err) && err.code === "EEXIST") return dir;
    console.warn(`[drops] could not create ${dir}: ${messageOf(err)}`);
    return null;
  }
}

/** Persist a dropped file, returning its absolute path.
 *
 *  Written to a staging name and renamed, so the path handed to the terminal never names a
 *  half-written file. The NAME is ours: the request carries no path at all, only bytes and a
 *  type, which is what leaves nothing to sanitize. */
export function saveDrop(sessionId: string, bytes: Buffer, mimeType: string, filename: string | null = null): string {
  const dir = ensureDropsDir(sessionId);
  if (!dir) throw new Error(`no drop directory for session ${sessionId}`);
  const absPath = path.join(dir, `${randomUUID()}${dropExtension(filename, mimeType)}`);
  const staging = `${absPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(staging, bytes, { mode: PRIVATE_FILE_MODE });
    renameSync(staging, absPath);
  } catch (err) {
    removeQuietly(staging);
    throw err;
  }
  return absPath;
}

/** Drop a session's files. Safe to call for sessions that never received one. */
export function cleanupSessionDrops(sessionId: string): void {
  const dir = dropsDir(sessionId);
  if (dir) removeQuietly(dir);
}

/** Remove the drop directories no surviving session owns.
 *
 *  cleanupSessionDrops runs from reap(), which a crash — or a machine losing power — never
 *  reaches, and what stays behind is a copy of whatever the user dropped. `liveIds` is what
 *  actually survived the restart: the tmux sessions still running. Nothing else can still be
 *  reading its drops, since a PTY without tmux died with the server that owned it.
 *
 *  Returns the ids it dropped, for the boot log. */
export function pruneOrphanDrops(liveIds: ReadonlySet<string>, root: string = DROPS_ROOT, writtenBefore: number | null = null): string[] {
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (!stat) return []; // nothing has been dropped yet
  // Never walk a root that is not ours. Removing entries from a directory somebody else
  // controls — or from wherever their symlink points — is precisely the damage the ownership
  // check exists to prevent, and this is the one code path here that deletes.
  if (!isPrivateToUs(stat)) {
    console.warn(`[drops] ${root} is not a private directory of ours — leaving it untouched`);
    return [];
  }
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const dropped: string[] = [];
  for (const name of names) {
    if (!SESSION_ID_RE.test(name) || liveIds.has(name)) continue;
    const dir = path.join(root, name);
    // Same rule as the settings sweep (#1061): without tmux, `liveIds` is empty even when a peer
    // is running, so its directories look like leftovers. Only what predates every live peer can
    // honestly be called abandoned. A directory we cannot stat is one we decline to judge.
    if (writtenBefore !== null && !isOlderThan(dir, writtenBefore)) continue;
    if (removeQuietly(dir)) dropped.push(name);
  }
  return dropped;
}

// mtime of a drop directory: bumped whenever a file lands in it, so it tracks the session's last
// use rather than its creation — which is what "could a running peer still want this" needs.
function isOlderThan(dir: string, cutoff: number): boolean {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  return stat ? stat.mtimeMs < cutoff : false;
}
