// Handing every working tree of a project its OWN port and database name (#1367).
//
// A worktree isolates files, not ports. Two trees running `yarn dev` both reach for 3000 and the
// second one dies; five trees sharing one database mean the tree that runs a migration breaks the
// other four. A project declares what it needs in `.mulmoterminal.json`:
//
//   "worktreeEnv": { "PORT": { "kind": "port", "base": 3000 }, "DB_NAME": { "kind": "slug" } }
//
// and each tree's terminals are started with those variables set to values nothing else holds.
//
// TWO ENTRY POINTS, and the split matters:
//
//   ensureWorktreeEnv  — the ONLY thing that allocates. Async, because deciding a port means
//                        asking the OS whether it is free. Called from the ws handlers once the
//                        cwd is known, and from createWorktree.
//   reservedWorktreeEnv — a synchronous read of what was already reserved. Never allocates. This
//                        is what the spawners call, and it has to be synchronous because they are.
//
// Allocating in ONE place is what keeps the two from drifting into different answers. It is also
// why probing happens only here: a probe at spawn time would find the tree's OWN dev server on
// its port, call it taken, and move the number — the tree would flee from itself. And because a
// tmux reattach never re-reads the environment, a value that moves is a value the running program
// no longer agrees with.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { loadDirConfig } from "./dir-config.js";
import { worktreeTask, worktreesRootDir } from "./worktree-task.js";
import { canonicalPath } from "../infra/canonical-path.js";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { heldReservation, parseReservations, releaseLine, reservationLine, type WorktreeEnvReservation } from "./worktree-env-log.js";
import {
  FIRST_WORKTREE_SLOT,
  MAX_PORT_SLOTS,
  MAX_SLUG_SUFFIX,
  PROJECT_SLOT,
  portForSlot,
  slugCandidate,
  slugWithSuffix,
  worktreeEnvValue,
  type WorktreeEnvSpec,
  type WorktreeEnvValue,
} from "../../common/worktreeEnv.js";

/** Where the reservations live. A function, not a constant, so MULMOTERMINAL_HOME redirects it
 *  the way it redirects the worktree root itself. */
export const worktreeEnvLogFile = (): string => path.join(mulmoterminalHome(), "worktree-env.jsonl");

/** How much of the directory's hash goes into a last-resort slug. Eight hex characters is what
 *  the managed worktree root already keys repos by, and it is short enough to leave a readable
 *  stem in front of it. */
const DIR_HASH_CHARS = 8;

/** How long the OS gets to answer "is this port free". A probe that hangs must not hold up a
 *  terminal; an unanswered bind is treated as taken, which costs one slot and never a wrong one. */
const PROBE_TIMEOUT_MS = 500;

/** Whether a TCP port can be bound right now on loopback.
 *
 *  Loopback and not 0.0.0.0: a dev server listening on every interface makes a loopback bind fail
 *  too, so this still sees it, while probing 0.0.0.0 would MISS a server bound to 127.0.0.1 only. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const settle = (free: boolean) => {
      server.removeAllListeners();
      server.close(() => resolve(free));
    };
    const timer = setTimeout(() => settle(false), PROBE_TIMEOUT_MS);
    timer.unref?.();
    server.once("error", () => {
      clearTimeout(timer);
      settle(false);
    });
    server.once("listening", () => {
      clearTimeout(timer);
      settle(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

function readLog(): WorktreeEnvReservation[] {
  const file = worktreeEnvLogFile();
  try {
    // Bounded by how many directories this app has ever handed a value to, not by time or by
    // anything another process appends — so reading it whole is safe (see CLAUDE.md).
    return existsSync(file) ? parseReservations(readFileSync(file, "utf8")) : [];
  } catch {
    return [];
  }
}

function appendLog(line: string): void {
  const file = worktreeEnvLogFile();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, line, "utf8");
  } catch (err) {
    console.warn(`[worktree-env] could not record a reservation in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A reservation whose directory is gone no longer holds anything. Deleting the line would need a
 *  rewrite, which is what the append-only format exists to avoid — so it is ignored at READ time
 *  instead, and the value it held becomes available again. */
const stillOnDisk = (entry: WorktreeEnvReservation): boolean => existsSync(entry.dir);

/** Which managed worktree a CANONICAL directory is in. The root is canonicalized to match: every
 *  path here has been through canonicalPath, and a home reached through a symlink (or a macOS
 *  /tmp that is really /private/tmp) would otherwise contain none of them. */
const taskOf = (dir: string): string | null => worktreeTask(dir, canonicalPath(worktreesRootDir()));

/** What this directory is called when a value has to be named after it: its worktree task, else
 *  its own folder name. */
const dirIdentity = (dir: string): string => taskOf(dir) ?? path.basename(dir);

/** The slot a directory starts looking from. The project's own checkout takes `base` itself, so a
 *  project that declared 3000 still sees 3000 where it always did, and its worktrees take the
 *  numbers above it. */
const firstSlotFor = (dir: string): number => (taskOf(dir) === null ? PROJECT_SLOT : FIRST_WORKTREE_SLOT);

/** The first port from `base` upward that nobody holds and the OS will give us, or null when the
 *  whole span is spoken for. */
async function allocatePort(base: number, firstSlot: number, taken: ReadonlySet<string>, portFree: (port: number) => Promise<boolean>): Promise<string | null> {
  for (let slot = firstSlot; slot < MAX_PORT_SLOTS; slot++) {
    const port = portForSlot(base, slot);
    if (port === null) break;
    if (taken.has(String(port))) continue;
    if (await portFree(port)) return String(port);
  }
  return null;
}

/** The first name derived from this directory that nobody holds, or null when even the fallbacks
 *  are taken. Unlike a port there is no OS to ask — a database this app never created is not
 *  something it can see — so the log is the whole answer, and `prefix` is what keeps two projects'
 *  `main` trees apart.
 *
 *  Past ninety-nine holders the readable names run out and the directory's own hash goes in. It
 *  goes in as the SUFFIX, not inside the identity: `slugWithSuffix` cuts the stem to make room, so
 *  a 63-character prefix can no longer truncate the hash away and hand every directory the same
 *  name — which is precisely the boundary where the old "unique by construction" claim was false
 *  (Codex review on #1367). Even that keeps looking rather than trusting the hash, so the return
 *  is only ever a name nothing else holds. */
function allocateSlug(prefix: string, identity: string, dir: string, taken: ReadonlySet<string>): string | null {
  for (let attempt = 1; attempt <= MAX_SLUG_SUFFIX; attempt++) {
    const candidate = slugCandidate(prefix, identity, attempt);
    if (!taken.has(candidate)) return candidate;
  }
  const hash = createHash("sha1").update(dir).digest("hex").slice(0, DIR_HASH_CHARS);
  for (let attempt = 1; attempt <= MAX_SLUG_SUFFIX; attempt++) {
    const candidate = slugWithSuffix(prefix, identity, attempt <= 1 ? `_${hash}` : `_${hash}_${attempt}`);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** Values a fresh allocation must not land on: everything held by anyone else, of this kind.
 *
 *  "Anyone else" is per (directory, VARIABLE) and not per directory — two ports declared in one
 *  project from the same base would otherwise both be given the base's first free slot, so a
 *  project asking for a web port and an admin port on 3000 would get one number twice. Kinds are
 *  counted apart because they are different spaces: a database named `3010` is not a port. */
function takenValues(reservations: readonly WorktreeEnvReservation[], dir: string, name: string, kind: WorktreeEnvReservation["kind"]): Set<string> {
  const held = reservations.filter((entry) => entry.kind === kind && stillOnDisk(entry) && !(entry.dir === dir && entry.name === name));
  return new Set(held.map((entry) => entry.value));
}

/** The declaration for a directory, or null when it makes none — the overwhelmingly common case,
 *  answered without touching the log at all. */
const specFor = (dir: string): WorktreeEnvSpec | null => loadDirConfig(dir).worktreeEnv;

/** Give up what this directory holds for variables it no longer declares.
 *
 *  Cheap for the overwhelming majority, which declare nothing and have no line in the log: readLog
 *  answers from an existsSync when the file was never written. Runs on a fresh spawn, not on the
 *  synchronous read every pty makes — reservedWorktreeEnv still returns early on an absent spec. */
function releaseUndeclared(dir: string, spec: WorktreeEnvSpec | null): void {
  const declared = new Set(Object.keys(spec ?? {}));
  readLog()
    .filter((entry) => entry.dir === dir && !declared.has(entry.name))
    .forEach((entry) => appendLog(releaseLine({ dir, name: entry.name })));
}

/** How many times a reservation may be re-attempted after losing a cross-process tie. More than
 *  one contender for a value is already rare; more than a handful in a row cannot happen without
 *  something else being wrong. */
const MAX_RESERVE_ATTEMPTS = 5;

/** Did somebody else get this value first?
 *
 *  There is a window between reading the log and appending to it, and a second server sharing
 *  MULMOTERMINAL_HOME can allocate the same value inside it — no lock, so the collision is
 *  possible (both bots on #1367 said so, and they were right). What must NOT happen is that it
 *  STICKS: two directories holding one port in the log is wrong for as long as the log lives,
 *  where a lost race is only worth one retry.
 *
 *  So the loser is decided AFTER the fact instead. The log is append-only and both processes read
 *  the same bytes, so both compute the same winner — the reservation that appears first — and
 *  exactly one of them yields. No lock, no stale-lock recovery, and nothing to clean up after a
 *  crash. */
function lostTheRace(reservations: readonly WorktreeEnvReservation[], entry: WorktreeEnvReservation): boolean {
  const holders = reservations.filter((held) => held.kind === entry.kind && held.value === entry.value && stillOnDisk(held));
  const winner = holders[0];
  return holders.length > 1 && !(winner?.dir === entry.dir && winner.name === entry.name);
}

/** Pick a value for one variable, record it, and keep it only if nobody beat us to it. Null when
 *  nothing is free — the caller leaves the variable unset and says so. */
async function reserveOne(dir: string, name: string, declared: WorktreeEnvSpec[string], portFree: (port: number) => Promise<boolean>): Promise<string | null> {
  const base = declared.kind === "port" ? declared.base : null;
  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt++) {
    // Re-read each time round: every append is another instance's reservation as much as ours,
    // and two variables of one directory must not be given the same number either.
    const reservations = readLog();
    const held = heldReservation(reservations, dir, name, base);
    if (held) return held.value;
    const taken = takenValues(reservations, dir, name, declared.kind);
    const value =
      declared.kind === "port"
        ? await allocatePort(declared.base, firstSlotFor(dir), taken, portFree)
        : allocateSlug(declared.prefix ?? "", dirIdentity(dir), dir, taken);
    if (value === null) return null;
    const entry: WorktreeEnvReservation = { dir, name, kind: declared.kind, base, value };
    appendLog(reservationLine(entry));
    if (!lostTheRace(readLog(), entry)) return value;
    // Value-scoped, not just (dir, name): a concurrent call for this same directory may already
    // have replaced the row with a good reservation of its own, and a release that named only the
    // variable would wipe a value a terminal is running on (Codex review on #1367).
    appendLog(releaseLine(entry));
  }
  return null;
}

/** Reserve every declared variable for `cwd` that does not already hold one, and return the whole
 *  set. Idempotent: a directory whose values are all reserved does no work and no IO beyond
 *  reading its config and the log. */
export async function ensureWorktreeEnv(cwd: string, portFree: (port: number) => Promise<boolean> = isPortFree): Promise<Record<string, string>> {
  const spec = specFor(cwd);
  const dir = canonicalPath(cwd);
  // BEFORE the early return, and before allocating: a directory that renamed `PORT` to `APP_PORT`
  // — or dropped `worktreeEnv` entirely — would otherwise hold its old value for as long as the
  // directory exists, and takenValues counts it, so the number stays blocked for every other tree.
  // Whole-directory release only happens when the worktree itself goes (Codex review on #1367).
  releaseUndeclared(dir, spec);
  if (!spec) return {};
  const resolved: Record<string, string> = {};
  for (const [name, declared] of Object.entries(spec)) {
    const value = await reserveOne(dir, name, declared, portFree);
    if (value === null) {
      console.warn(`[worktree-env] no free ${declared.kind} left for ${name} in ${dir} — leaving it unset`);
      continue;
    }
    resolved[name] = value;
  }
  return resolved;
}

/** What `dir` already holds — a synchronous read for the spawners, which cannot await.
 *
 *  Reserving is deliberately NOT done here: a caller that reaches a spawn without having gone
 *  through ensureWorktreeEnv gets a variable that is absent, which is a feature that visibly did
 *  not happen. Allocating a second way would instead give it a DIFFERENT value from the one the
 *  header shows and the tree beside it holds. */
export function reservedWorktreeEnv(cwd: string): Record<string, string> {
  const spec = specFor(cwd);
  if (!spec) return {};
  const dir = canonicalPath(cwd);
  const reservations = readLog();
  const resolved: Record<string, string> = {};
  Object.entries(spec).forEach(([name, declared]) => {
    const held = heldReservation(reservations, dir, name, declared.kind === "port" ? declared.base : null);
    if (held) resolved[name] = held.value;
  });
  return resolved;
}

/** The same values, shaped for the header chip — a port carries the URL that opens it. */
export function worktreeEnvValues(cwd: string): WorktreeEnvValue[] {
  const spec = specFor(cwd);
  if (!spec) return [];
  const reserved = reservedWorktreeEnv(cwd);
  return Object.entries(spec).flatMap(([name, declared]) => {
    const value = reserved[name];
    return value === undefined ? [] : [worktreeEnvValue(name, value, declared.kind)];
  });
}

/** Give up everything a directory held, so its port comes back into circulation the moment the
 *  worktree is removed rather than when something notices the path is gone.
 *
 *  Safe to call once the directory is already gone: canonicalPath resolves the deepest ancestor
 *  that still exists and re-attaches the rest, so a removed worktree spells the same as it did
 *  when its value was reserved. */
export function releaseWorktreeEnv(cwd: string): void {
  appendLog(releaseLine({ dir: canonicalPath(cwd) }));
}
