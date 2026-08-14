// Per-directory environment values a project declares once and this app hands out uniquely
// (#1367): the port a dev server binds, the database name a migration touches. Files are
// isolated by a worktree; these are not, so two trees running `yarn dev` race for one 3000.
//
// The pure half — what a slot is worth, what a slug looks like, and the shape the browser
// receives. Reserving lives in server/config/worktree-env.ts, which needs the disk.

/** How far apart two consecutive slots sit.
 *
 *  Ten and not one because a dev server that finds its port taken commonly moves to the NEXT one
 *  (vite does this by default). At a stride of one, that fallback lands on the neighbouring
 *  worktree's reserved port — so the mechanism meant to keep two trees apart would be what puts
 *  them on the same number. */
export const PORT_SLOT_STRIDE = 10;

/** How many slots a `base` may spread over. A project wanting more parallel trees than this has
 *  a bigger problem than the port. */
export const MAX_PORT_SLOTS = 32;

/** Ports below this are privileged on Unix and a dev server cannot bind them unprivileged. */
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

/** The highest `base` a project may declare: high enough that EVERY slot above it is still a
 *  usable port. Capped at the config boundary rather than checked at allocation time, because
 *  running out of range there would mean the variable is simply not set — a feature that looks
 *  switched off, with the reason nowhere near the file that caused it. */
export const MAX_PORT_BASE = MAX_PORT - MAX_PORT_SLOTS * PORT_SLOT_STRIDE;

/** The slot a directory that is NOT a managed worktree starts looking at — `base` itself, so a
 *  project that declares `base: 3000` sees 3000 in its own checkout and the worktrees take the
 *  numbers after it. Worktrees start one slot up for exactly that reason. */
export const PROJECT_SLOT = 0;
export const FIRST_WORKTREE_SLOT = 1;

/** Postgres truncates an identifier at 63 bytes, and a name that is silently truncated is a name
 *  two worktrees can share. Cut it here, where the uniqueness suffix can still be applied. */
export const MAX_SLUG_CHARS = 63;

/** How many `_2`, `_3`… suffixes a colliding slug may try before giving up. */
export const MAX_SLUG_SUFFIX = 99;

/** A shell variable name. Anything else could not be exported, so it is rejected at the config
 *  boundary rather than silently dropped by the shell. */
export const ENV_NAME_RE = /^[A-Za-z_]\w*$/;

/** How many variables one directory may declare. */
export const MAX_WORKTREE_ENV_VARS = 16;

/** What a directory declares for one variable. `port` is allocated a number; `slug` a name. */
export type WorktreeEnvVar = { kind: "port"; base: number } | { kind: "slug"; prefix?: string | undefined };

/** The whole `worktreeEnv` block: variable name → what to put in it. */
export type WorktreeEnvSpec = Record<string, WorktreeEnvVar>;

/** One resolved variable as the browser receives it. `url` is set only for a port, and is what
 *  makes the header chip a link to the dev server rather than a label. */
export interface WorktreeEnvValue {
  name: string;
  value: string;
  url: string | null;
}

/** The port for a slot, or null when it would leave the usable range. */
export function portForSlot(base: number, slot: number): number | null {
  const port = base + slot * PORT_SLOT_STRIDE;
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/** Where a dev server on this port answers. Loopback, matching what the server itself binds by
 *  default — a chip that opened a LAN address would be a link to somewhere the process is not. */
export const localUrlForPort = (port: number | string): string => `http://localhost:${port}`;

/** The identifier-safe core of a slug: lowercase, `[a-z0-9_]`, no leading digit (Postgres and
 *  most container runtimes reject one), never empty. */
export function slugifyIdentifier(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    // A single edge underscore each side is all there can be: the line above already collapsed
    // every run into one. `_+` here would be a backtracking pattern doing nothing extra.
    .replace(/^_/, "")
    .replace(/_$/, "");
  if (!cleaned) return "x";
  return /^\d/.test(cleaned) ? `x${cleaned}` : cleaned;
}

/** A slug whose SUFFIX is guaranteed to survive: the stem is cut to leave room for it, never the
 *  other way round.
 *
 *  Which way round is the whole point. Truncating the finished string would push the suffix off
 *  the end of a long prefix — and then two directories that differ only in what the suffix says
 *  come out identical, which is the one outcome a suffix exists to prevent. */
export function slugWithSuffix(prefix: string, identity: string, suffix: string): string {
  const stem = slugifyIdentifier(`${prefix}${identity}`);
  return `${stem.slice(0, MAX_SLUG_CHARS - suffix.length)}${suffix}`;
}

/** The `n`-th candidate name for a slug variable (1-based, so the first has no suffix). */
export const slugCandidate = (prefix: string, identity: string, attempt: number): string => slugWithSuffix(prefix, identity, attempt <= 1 ? "" : `_${attempt}`);

/** A resolved value, ready for the browser. */
export function worktreeEnvValue(name: string, value: string, kind: WorktreeEnvVar["kind"]): WorktreeEnvValue {
  return { name, value, url: kind === "port" ? localUrlForPort(value) : null };
}
