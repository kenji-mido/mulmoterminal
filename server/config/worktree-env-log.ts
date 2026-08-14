// The on-disk record of which working tree was handed which value (#1367), as a pure format.
//
// APPEND-ONLY, for the reason session-tool-groups.ts is: MULMOTERMINAL_HOME is shared by every
// server on this machine (several checkouts of one repo run side by side here), and a
// read-merge-write loses whichever of two instances finishes first. A lost reservation is not a
// tidiness problem — the port it held is then handed to a second directory, which is the exact
// collision this whole feature exists to prevent.
//
// One JSON object per line. A line that does not parse is dropped on its own: a file cut off
// mid-append costs the last entry, never the ones before it.
import { isRecord } from "../../common/isRecord.js";

/** One handed-out value. `base` is recorded so that editing `base` in `.mulmoterminal.json`
 *  invalidates what was reserved against the old one — otherwise a project that moved from 3000
 *  to 4000 would go on exporting 3010 with nothing to say why. */
export interface WorktreeEnvReservation {
  dir: string;
  name: string;
  kind: "port" | "slug";
  base: number | null;
  value: string;
}

/** A reservation given up, narrowed by however much the releaser actually knows.
 *
 *  - `dir` alone — everything that directory held. A worktree is removed as a whole, and naming its
 *    variables there would let the release go stale against the config.
 *  - `+ name` — one variable, whatever it holds. What a directory that RENAMED or dropped a key
 *    needs: the old value comes back into circulation while the directory itself lives on.
 *  - `+ value` — one variable, and ONLY while it still holds that exact value. This is the one a
 *    lost race must use: by the time the loser gets to write, the same (dir, name) may already
 *    hold a NEWER reservation made by a concurrent call, and a release keyed only by name would
 *    wipe a value a terminal is running on (Codex review on #1367). A release naming a value can
 *    never take a different one with it. */
interface ReleaseEntry {
  dir: string;
  name?: string;
  value?: string;
  release: true;
}

/** Which reservation a release is aimed at. Absent fields widen it — see ReleaseEntry. */
export interface ReleaseTarget {
  dir: string;
  name?: string;
  value?: string;
}

const key = (dir: string, name: string): string => `${dir} ${name}`;

/** The newline LEADS rather than trails, like session-id-log.ts: whatever the file ended with,
 *  an appended entry starts its own line, so a truncated write costs one entry and not the next. */
export const reservationLine = (entry: WorktreeEnvReservation): string => `\n${JSON.stringify(entry)}`;

export const releaseLine = (target: ReleaseTarget): string => `\n${JSON.stringify({ ...target, release: true } satisfies ReleaseEntry)}`;

function parsedLine(line: string): WorktreeEnvReservation | ReleaseEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (isRelease(raw)) return raw;
    return isReservation(raw) ? raw : null;
  } catch {
    return null;
  }
}

const isRelease = (raw: unknown): raw is ReleaseEntry =>
  isRecord(raw) &&
  raw.release === true &&
  typeof raw.dir === "string" &&
  (raw.name === undefined || typeof raw.name === "string") &&
  (raw.value === undefined || typeof raw.value === "string");

const isReservation = (raw: unknown): raw is WorktreeEnvReservation =>
  isRecord(raw) &&
  typeof raw.dir === "string" &&
  typeof raw.name === "string" &&
  (raw.kind === "port" || raw.kind === "slug") &&
  (raw.base === null || typeof raw.base === "number") &&
  typeof raw.value === "string";

/** What the log says now: replayed IN ORDER so a later line for the same (dir, name) wins and a
 *  release drops everything that directory held. Ordering is the whole point — this is not a
 *  union of the lines. */
export function parseReservations(contents: string): WorktreeEnvReservation[] {
  const live = new Map<string, WorktreeEnvReservation>();
  contents.split("\n").forEach((line) => {
    const entry = parsedLine(line);
    if (!entry) return;
    if (isRelease(entry)) {
      const released = [...live.values()].filter(
        (held) => held.dir === entry.dir && (entry.name === undefined || held.name === entry.name) && (entry.value === undefined || held.value === entry.value),
      );
      released.forEach((held) => live.delete(key(held.dir, held.name)));
      return;
    }
    live.set(key(entry.dir, entry.name), entry);
  });
  return [...live.values()];
}

/** The reservation a directory holds for one variable, or null. Also null when it was made
 *  against a different `base` — see the field's comment. */
export function heldReservation(
  reservations: readonly WorktreeEnvReservation[],
  dir: string,
  name: string,
  base: number | null,
): WorktreeEnvReservation | null {
  const held = reservations.find((entry) => entry.dir === dir && entry.name === name);
  if (!held) return null;
  return held.base === base ? held : null;
}
