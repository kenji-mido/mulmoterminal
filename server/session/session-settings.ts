// Claude Code's per-session `--settings`, written to a file when it carries secrets.
//
// `--settings` accepts a path OR an inline JSON string, and every session until now
// passed it inline. That is fine for hooks, but a provider session's settings carry an
// API token in their `env` block — and an inline argument is visible to every user on
// the host through `ps`. So a settings payload with an env block goes to a 0600 file and
// only its PATH reaches argv (#579).
//
// The env block is the transport for a reason: Claude Code applies it itself, so it
// reaches the session identically on the host, under tmux — where a pane inherits the
// tmux SERVER's environment, not the spawning client's — and inside a container.
import { writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { removeQuietly } from "../infra/fs-cleanup.js";
import { SESSION_ID_RE } from "../config/env.js";

const SETTINGS_DIR = path.join(os.homedir(), ".mulmoterminal", "settings");

const settingsFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}.json`);
const mcpConfigFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}-mcp.json`);

// Windows has a second, unrelated reason to use a file: there, a `.cmd`-installed Claude is
// launched through cmd.exe (#798), so a JSON argument is parsed by cmd and then by the
// child's CRT, and the two disagree about quoting. A path has no quotes and no
// metacharacters, which removes that layer rather than escaping through it (#813).
const mustUseFile = (secret: boolean, platform: NodeJS.Platform): boolean => secret || platform === "win32";

function writePrivate(file: string, json: string): string {
  mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, json, { encoding: "utf8", mode: 0o600 });
  return file;
}

// The settings to pass as `--settings`: the JSON itself when it holds nothing secret and
// nothing between us and Claude Code would re-parse it, otherwise a private file's path.
export function settingsArgument(sessionId: string, json: string, secret: boolean, platform: NodeJS.Platform = process.platform): string {
  return mustUseFile(secret, platform) ? writePrivate(settingsFile(sessionId), json) : json;
}

// The same for `--mcp-config`, which is the other large JSON argument a spawn carries. It
// holds no secret, so only the Windows reason applies.
export function mcpConfigArgument(sessionId: string, json: string, platform: NodeJS.Platform = process.platform): string {
  return mustUseFile(false, platform) ? writePrivate(mcpConfigFile(sessionId), json) : json;
}

// Run a spawn, taking the session's settings file with it if the spawn throws. A session
// that never starts never reaches reap(), where the cleanup normally happens — so without
// this a failed spawn leaves a token-bearing file behind (#579).
export function withSettingsCleanup<T>(sessionId: string, spawn: () => T): T {
  try {
    return spawn();
  } catch (err) {
    cleanupSessionSettings(sessionId);
    throw err;
  }
}

// Drop a session's files. Safe to call for sessions that never wrote one.
export function cleanupSessionSettings(sessionId: string): void {
  removeQuietly(settingsFile(sessionId));
  removeQuietly(mcpConfigFile(sessionId));
}

/** Drop settings files left behind by a server that never got to reap.
 *
 *  `cleanupSessionSettings` runs from reap(), which a crash — or a machine losing power —
 *  never reaches. What stays behind is not inert: a provider session's file holds its API
 *  token, so without this a token outlives the session that used it, survives being rotated
 *  or revoked, and survives the provider being removed from the config entirely.
 *
 *  `liveIds` is what actually survived the restart — the tmux sessions still running. Nothing
 *  else can still be reading its settings: a PTY without tmux died with the server that owned
 *  it. Returns the ids it dropped, for the boot log.
 *
 *  That last inference only holds for the process that OWNED the previous lifetime. A second
 *  instance running RIGHT NOW has live PTYs of its own, and on a host without tmux `liveIds` is
 *  empty — so every one of its files read as a leftover and was deleted underneath it (#1061,
 *  seen in the field: eight settings files of live sessions removed by a peer's boot).
 *
 *  `writtenBefore` is the cutoff that fixes it: the moment the earliest live peer started. A file
 *  older than that cannot belong to any of them, so it is still a leftover; a newer one might be,
 *  and a maybe is not enough to delete somebody's live state. Null means nothing else is running
 *  and every non-surviving file is fair game — the original behaviour, which is also what a lone
 *  instance sees. */
export function pruneOrphanSettings(liveIds: ReadonlySet<string>, dir: string = SETTINGS_DIR, writtenBefore: number | null = null): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no settings dir yet — nothing has been written
  }
  const dropped: string[] = [];
  for (const name of names) {
    const id = sessionIdFromFileName(name);
    if (id === null || liveIds.has(id)) continue;
    const file = path.join(dir, name);
    if (writtenBefore !== null && !isOlderThan(file, writtenBefore)) continue;
    if (removeQuietly(file)) dropped.push(name);
  }
  return dropped;
}

// A file we cannot stat is one we decline to judge: unreadable is not evidence of being old, and
// the cost of guessing wrong here is deleting state a running session may still need.
function isOlderThan(file: string, cutoff: number): boolean {
  try {
    return statSync(file).mtimeMs < cutoff;
  } catch {
    return false;
  }
}

// `<id>.json` and `<id>-mcp.json` are the two we write, and `<id>` is always a session id —
// every caller takes one from randomUUID() or a SESSION_ID_RE match. Requiring that shape is
// what keeps this from deleting a file that merely happens to end in `.json`: the directory
// is ours, but "ours" is not a good enough reason to remove something we did not write.
function sessionIdFromFileName(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const stem = name.slice(0, -".json".length);
  const id = stem.endsWith("-mcp") ? stem.slice(0, -"-mcp".length) : stem;
  return SESSION_ID_RE.test(id) ? id : null;
}
