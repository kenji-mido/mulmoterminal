// Serializing a read-modify-write of the config ACROSS PROCESSES.
//
// Its own module because it is its own concern: every writer of ~/.mulmoterminal/config.json
// needs it, while app-config.ts is about the SHAPE of that file rather than about who may touch
// it when — and that file is already well over its line budget.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { openSync, closeSync, unlinkSync, statSync, mkdirSync, writeSync, readFileSync } from "node:fs";
import { isRecord } from "../../common/isRecord.js";

// One machine runs several mulmoterminals (several checkouts, side by side) and they share ONE
// config.json. `writeFileAtomicSync` makes each write all-or-nothing, which stops a truncated
// file — it does nothing about two processes that both READ the old list, each add their own
// directory, and each write: the second rename replaces the first process's addition, and a
// saved directory is gone with no error anywhere.
//
// The window is small, and it is exactly the window a user hits by launching a terminal in two
// windows at once — which is how the whole list was lost once already (a client-side version of
// the same race). So the critical section is claimed with a lock file rather than hoped over.
const LOCK_SUFFIX = ".lock";
// A critical section here is synchronous file I/O — microseconds. So a lock still held after
// SECONDS is not a slow writer, it is a crashed one, and it is broken rather than obeyed: a crash
// must not wedge the config for the rest of the session.
const LOCK_STALE_MS = 5_000;
// Deliberately LONGER than the stale window, so a lock left by a crash is always broken inside
// the wait instead of timing out. A timeout therefore means real contention, never wreckage.
const LOCK_WAIT_MS = 6_000;
const LOCK_RETRY_MS = 15;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasErrnoCode = (err: unknown): err is { code: string } => isRecord(err) && typeof err.code === "string";

/** Thrown when the lock could not be taken. Its own class so a route can answer "retry" rather
 *  than reporting a generic failure for something that will very likely work in a moment. */
export class ConfigLockTimeout extends Error {
  constructor(file: string) {
    super(`config is being written by another process (${path.basename(file)}) — try again`);
    this.name = "ConfigLockTimeout";
  }
}

/** Take the config lock, run `critical`, and release it — whatever `critical` does.
 *
 *  IT NEVER RUNS `critical` WITHOUT THE LOCK. An earlier version proceeded on timeout, on the
 *  reasoning that losing the user's action is worse than a narrow race; that was wrong twice
 *  over. The action is not lost — the caller gets a retryable error, and the one caller that
 *  matters (recording a launched directory) retries on the next launch. And "a narrow race" is
 *  precisely the bug this exists to close: this writer would read the old config while the holder
 *  is still inside its own read-modify-write, and overwrite it. A rare silent deletion of someone
 *  else's data is worse than a visible "try again". */
export async function withConfigLock<T>(file: string, critical: () => T | Promise<T>): Promise<T> {
  const lockPath = `${file}${LOCK_SUFFIX}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  // What identifies THIS claim inside the lock file, so the release can tell "still mine" from
  // "someone reclaimed it". The pid alone is not enough — one process can hold the lock twice in
  // sequence, and the second claim must not be releasable by the first.
  const token = `${hostname()}:${process.pid}:${randomUUID()}`;
  let held = false;
  while (!held && Date.now() < deadline) {
    held = tryClaim(lockPath, token);
    if (!held) await sleep(LOCK_RETRY_MS);
  }
  if (!held) throw new ConfigLockTimeout(file);
  try {
    // AWAITED inside the lock. Every caller today is synchronous, but a `critical` that returned
    // a promise would otherwise release the lock the moment it was CREATED — the section would
    // run outside the protection it asked for, which is worse than not locking at all because it
    // looks locked.
    return await critical();
  } finally {
    release(lockPath, token);
  }
}

/** Release ONLY a lock we still own.
 *
 *  Stale-breaking makes this necessary: if our lock was reclaimed while we were inside (a
 *  critical section delayed past `LOCK_STALE_MS`), the file now belongs to whoever took it, and
 *  unlinking it would free a lock somebody else is holding — a cascade where each writer frees
 *  the next one's claim and several read-modify-writes overlap. The claim writes a token and this
 *  checks it, so the loser of a theft removes nothing and the cascade stops at one.
 *
 *  It also SAYS SO. Being reclaimed means a config write took longer than `LOCK_STALE_MS`, which
 *  is either a machine in trouble or a wrong assumption in this file; silence would leave the
 *  next person guessing. */
function release(lockPath: string, token: string): void {
  try {
    // The token is NOT a secret: an ownership marker, minted per claim and readable by anyone who
    // can read the lock file at all. Nothing is authorised by matching it and no attacker gains
    // from learning it, so a constant-time compare would be ceremony.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (readFileSync(lockPath, "utf8") !== token) {
      console.warn(`[config] lock ${path.basename(lockPath)} was reclaimed while held — a config write took over ${LOCK_STALE_MS}ms`);
      return;
    }
    unlinkSync(lockPath);
  } catch {
    // Already gone: a stale-breaker removed it and nothing replaced it yet. Nothing to undo.
  }
}

/** One attempt at the claim. True when this call now holds the lock.
 *
 *  Every failure is classified rather than lumped into "someone else has it":
 *
 *  - **EEXIST** is the only real contention. If the holder is older than `LOCK_STALE_MS` it
 *    crashed, so the lock is broken; otherwise the caller waits.
 *  - **ENOENT** is a first-ever write — `~/.mulmoterminal` does not exist yet. Reading that as
 *    contention made a fresh install wait out the whole timeout and then refuse to save anything.
 *  - **anything else** (a read-only directory, a permissions problem) will not become true by
 *    waiting, so it is raised immediately instead of costing the caller the full timeout first. */
function tryClaim(lockPath: string, token: string): boolean {
  try {
    // `wx` is the claim: it fails if the file exists, which is what makes this a lock rather than
    // a note that someone once intended to hold one. The token goes in through the same handle,
    // so the lock never exists unowned.
    const handle = openSync(lockPath, "wx");
    try {
      writeSync(handle, token);
    } finally {
      closeSync(handle);
    }
    return true;
  } catch (err) {
    const code = hasErrnoCode(err) ? err.code : "";
    if (code === "ENOENT") {
      mkdirSync(path.dirname(lockPath), { recursive: true });
      return tryClaim(lockPath, token);
    }
    if (code !== "EEXIST") throw err;
    // A lock whose owner is gone is broken here, not waited out; the next attempt claims it. A
    // FAILED unlink deliberately falls through to the caller's wait rather than retrying at full
    // speed — the claim would fail the same way and `breakable` would say the same thing.
    if (breakable(lockPath)) {
      try {
        unlinkSync(lockPath);
        return tryClaim(lockPath, token);
      } catch {
        // Someone else broke it first, or we may not remove it at all.
      }
    }
    return false;
  }
}

/** Whether a lock may be taken from whoever wrote it.
 *
 *  AGE ALONE IS NOT ENOUGH, and this is the correction that matters: `mtime` says when the lock
 *  was created, not whether its owner is still inside. Breaking it on age took it from a live
 *  writer that was merely slow — paused, or blocked in synchronous filesystem I/O — and a second
 *  writer then entered the read-modify-write the first was still in the middle of. That is the
 *  overlap this whole file exists to prevent, reintroduced by its own recovery path.
 *
 *  So a lock is broken only when it is old AND its owner is GONE. The owner is asked about
 *  directly: `process.kill(pid, 0)` sends no signal and answers "does this process exist".
 *
 *  Three cases the pid cannot answer, each resolved toward the safe side:
 *
 *  - **Another host.** `~/.mulmoterminal` can live on a network share, where a pid means nothing
 *    — it might match an unrelated local process, or miss a live remote one. The token carries
 *    the hostname, and a lock from elsewhere is left alone: a foreign writer we cannot ask about
 *    is treated as alive.
 *  - **A lock we cannot parse** (an older build, a crash mid-claim). Nothing owns it that we can
 *    find, and refusing forever would wedge the config, so age decides — as it did before.
 *  - **A live owner that is genuinely stuck.** Its lock is never broken, so writers time out and
 *    answer "try again" instead of overlapping. Refusing is the right failure: the wedged process
 *    is a problem the user can see, while a silent lost update is not.
 */
function breakable(lockPath: string): boolean {
  if (!olderThanStale(lockPath)) return false;
  const owner = readOwner(lockPath);
  if (!owner) return true; // unreadable or unparseable: age is all there is to go on
  if (owner.host !== hostname()) return false; // another machine's pid means nothing here
  return !processAlive(owner.pid);
}

function olderThanStale(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    // Vanished between the failed claim and this check — not stale, just gone.
    return false;
  }
}

function readOwner(lockPath: string): { host: string; pid: number } | null {
  try {
    const [host, pid] = readFileSync(lockPath, "utf8").split(":");
    const parsed = Number(pid);
    return host && Number.isInteger(parsed) && parsed > 0 ? { host, pid: parsed } : null;
  } catch {
    return null;
  }
}

/** Does this process still exist? Signal 0 performs the permission and existence checks without
 *  delivering anything. An EPERM means it exists and belongs to someone else — still alive. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return hasErrnoCode(err) && err.code === "EPERM";
  }
}
