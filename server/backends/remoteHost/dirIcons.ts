// A directory's icon image, packed for the phone (#1556).
//
// The browser gets `/api/dir-icon?cwd=…` and fetches the file itself. The phone has no route to
// this host at all — it speaks over Firestore command docs — so the picture has to travel inside
// the reply, which is what everything here is about: turning a resolved DirIcon into one string,
// and keeping the pile of them small enough that the reply still lands.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { DirIcon } from "../../config/dir-icon.js";
import type { TerminalSessionSummary } from "./terminalScreen.js";

// One image, before base64 inflates it by a third. Measured over the 22 repositories on the
// author's machine that carry a detectable icon: largest 25931 bytes, median 4286, mean 5051. So
// this is a ceiling nothing normal reaches — it exists to stop one hand-made multi-resolution
// .ico from costing the whole reply, not to ration ordinary favicons.
export const DIR_ICON_MAX_BYTES = 48 * 1024;

// And the pile. The reply is written to a Firestore command doc, which rejects anything over
// 1 MiB — and it rejects the WHOLE doc, so an overrun would empty the phone's session list rather
// than dim one row (#1042). All 22 of those icons together come to 148 KB of base64, so this is
// roughly twice what a busy grid actually asks for.
export const DIR_ICONS_MAX_CHARS = 256 * 1024;

/** src by id — the phone looks a row's `iconId` up in here. */
export interface DirIconTable {
  [iconId: string]: string;
}

export interface DirIconSources {
  // The icon that directory's cells show, auto-detection included (dir-config.ts's dirIconFor).
  iconOf: (cwd: string) => DirIcon | null;
  // The file's bytes, or null when it cannot be read or is too big. Injected so the packing rules
  // are testable without a filesystem; readIconFile below is what the server passes.
  readIcon: (path: string) => Buffer | null;
}

// Everything here follows from one fact: the icon was checked as a PATH — inside the directory,
// a real file, realpath re-checked (resolveFileWithinDir) — and is opened again later, by name.
// Whatever answers to that name now is what actually gets read, so it is re-checked here rather
// than assumed (Codex on #1558). Three ways it can differ, and what stops each:
//
//   a symlink out of the repository  O_NOFOLLOW — else the confinement is defeated by a rename,
//                                    and a file elsewhere on the machine is base64'd to the phone
//   a FIFO                           O_NONBLOCK — else `open` waits for a writer, and since this
//                                    is synchronous, the whole server waits with it
//   anything else not a file         the fstat below, which asks the OPEN DESCRIPTOR what it is
//
// Neither flag exists on Windows; there `|| 0` drops it and the fstat is the whole check.
const ICON_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);

/** An icon file's bytes, or null when it is unreadable, not a regular file, or over
 *  DIR_ICON_MAX_BYTES.
 *
 *  Never reads more than the cap, so the cap is a fact about the returned buffer rather than a
 *  claim about the file. `stat` then `readFile` would be neither: this is a file in someone
 *  else's repository, written by tools this process does not control, so between the two calls
 *  it can become something else entirely — and the whole of THAT is what would get base64'd and
 *  handed to a Firestore document with a hard 1 MiB ceiling. */
export function readIconFile(iconPath: string): Buffer | null {
  let fd: number | null = null;
  try {
    fd = openSync(iconPath, ICON_OPEN_FLAGS);
    if (!fstatSync(fd).isFile()) return null;
    // One byte past the cap: a file that fills this buffer is over it, and that is knowable
    // without reading the rest of whatever it turned out to be.
    const buffer = Buffer.alloc(DIR_ICON_MAX_BYTES + 1);
    const read = fillFromFile(fd, buffer);
    return read > DIR_ICON_MAX_BYTES ? null : buffer.subarray(0, read);
  } catch {
    return null; // renamed since it was resolved, or no longer readable — the row just has no icon
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Read until the buffer is full or the file ends. A loop, because readSync is allowed to answer
// with less than it was asked for, and a short first read would otherwise truncate the image.
function fillFromFile(fd: number, buffer: Buffer): number {
  let read = 0;
  while (read < buffer.length) {
    const got = readSync(fd, buffer, read, buffer.length - read, read);
    if (got === 0) return read;
    read += got;
  }
  return read;
}

/** The one string that stands for this icon on the wire, or null when the file cannot travel.
 *  Both the session list and the screen read go through here, or a directory could end up with
 *  an icon in the list and none on its own screen. */
export function dirIconSrc(icon: DirIcon, readIcon: DirIconSources["readIcon"]): string | null {
  if (icon.source === "url") return icon.url;
  const bytes = readIcon(icon.path);
  return bytes ? `data:${icon.mime};base64,${bytes.toString("base64")}` : null;
}

// Content-addressed, so the six clones of one repository — and the nine that share a copied
// `public/favicon.ico` — send those bytes once. Truncated because this id is repeated on every
// row that uses it and never leaves the reply: 64 bits of a SHA-256 over the src is far more than
// the handful of icons one host has.
const ICON_ID_CHARS = 16;
const iconIdOf = (src: string): string => createHash("sha256").update(src).digest("hex").slice(0, ICON_ID_CHARS);

export interface DirIconPacking {
  iconIdByCwd: Map<string, string>;
  icons: DirIconTable;
}

/** The icons for these directories, deduplicated by content and cut off at the budget.
 *
 *  Order matters: `cwds` is walked as given, so a caller passing the rows in the order the phone
 *  will show them spends the budget on the top of the list and drops the tail. */
export function collectDirIcons(cwds: readonly string[], sources: DirIconSources): DirIconPacking {
  const iconIdByCwd = new Map<string, string>();
  const icons: DirIconTable = {};
  let chars = 0;
  for (const cwd of cwds) {
    if (!cwd || iconIdByCwd.has(cwd)) continue;
    const src = srcForDir(cwd, sources);
    if (!src) continue;
    const id = iconIdOf(src);
    // An id already in the table costs nothing more, so it is never what the budget refuses.
    if (!icons[id]) {
      if (chars + src.length > DIR_ICONS_MAX_CHARS) continue;
      icons[id] = src;
      chars += src.length;
    }
    iconIdByCwd.set(cwd, id);
  }
  return { iconIdByCwd, icons };
}

// A directory that resolves no icon, or one whose file has since been renamed, is not an error —
// its rows simply carry none.
function srcForDir(cwd: string, sources: DirIconSources): string | null {
  const icon = sources.iconOf(cwd);
  return icon ? dirIconSrc(icon, sources.readIcon) : null;
}

/** What `listTerminalSessions` answers with: the rows, and the images they point into. */
export interface TerminalSessionListing {
  sessions: TerminalSessionSummary[];
  icons: DirIconTable;
}

/** The session list with each row's directory image attached.
 *
 *  `iconId` is spread in only when there is one. Writing `iconId: map.get(cwd)` would leave the
 *  key behind holding `undefined`, and Firestore rejects the whole reply over one such value —
 *  every row vanishes from the phone rather than one losing its picture (#1042). */
export function withDirIcons(sessions: readonly TerminalSessionSummary[], sources: DirIconSources): TerminalSessionListing {
  const { iconIdByCwd, icons } = collectDirIcons(
    sessions.map((session) => session.cwd),
    sources,
  );
  return {
    sessions: sessions.map((session) => {
      const iconId = iconIdByCwd.get(session.cwd);
      return iconId ? { ...session, iconId } : session;
    }),
    icons,
  };
}
