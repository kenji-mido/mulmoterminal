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
import { escapeBatchArgument } from "../infra/cmd-escape.js";
import { removeQuietly } from "../infra/fs-cleanup.js";
import { SESSION_ID_RE } from "../config/env.js";

const SETTINGS_DIR = path.join(os.homedir(), ".mulmoterminal", "settings");

const settingsFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}.json`);
const mcpConfigFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}-mcp.json`);
const appendedPromptFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}-prompt.txt`);
const seedPromptFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}-seed.txt`);

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

/** Where `--append-system-prompt`'s text travels. Its own type because Claude Code names the two
 *  forms with DIFFERENT flags, unlike `--settings`, which takes either. */
export type AppendedPromptArgument = { kind: "inline"; text: string } | { kind: "file"; path: string };

// And the same again for the appended system prompt — with a harder version of the Windows
// reason. The other two are merely awkward to quote through cmd.exe; this one is impossible: a
// Windows command line has no encoding for a newline at all (CR/LF end the line), and the text is
// a MULTI-LINE preset by default, so escapeBatchArgument refused it and every Claude session on a
// `.cmd` install failed to start (#1516).
//
// There is nothing to escape it INTO. Substituting the newlines away would hand the agent a
// different instruction, which is the exact failure cmd-escape.ts throws to prevent — so the
// answer is the one already used above: give Claude Code the path and let it read the file.
export function appendedPromptArgument(sessionId: string, prompt: string, platform: NodeJS.Platform = process.platform): AppendedPromptArgument {
  return mustUseFile(false, platform) ? { kind: "file", path: writePrivate(appendedPromptFile(sessionId), prompt) } : { kind: "inline", text: prompt };
}

// A seed prompt an agent takes as an ARGUMENT — grok and muse as a positional, antigravity as
// `--prompt-interactive`'s value. None of the three can be handed a file, so the same answer as
// above is not available: what goes on the command line has to be the prompt itself.
//
// And it cannot be, when it has a newline in it. A Windows command line has no encoding for one, so
// escapeBatchArgument refuses the argument and the session never starts — and a skill seed with
// arguments is ALWAYS multi-line, because codexifySkillSeed puts a blank line after the skill line
// (#1518). Collapsing the newlines away is the substitution #1516 rejected: it hands the agent a
// different instruction, silently.
//
// So the prompt travels in a file and the command line carries a single-line INSTRUCTION to read
// it. The agent's first act becomes a file read, which is a real behaviour change — so it is made
// only where the direct form is impossible.
//
// Impossible has TWO shapes, and they do not share a platform. The newline above is Windows-only.
// LENGTH is not: a command line runs out of room everywhere, and on the platforms this server
// actually runs tmux on it runs out FIRST. `ptySpawn` starts a persistent session through
// `tmux new-session -A … -- <bin> <args>` (pty-spawn.ts, tmux.ts), and tmux answers a command line
// past its own limit with "command too long" — which kills the session rather than the argument,
// so it is a worse failure than the Windows one, not a milder one.
//
// The limit is on the WHOLE command line, not on any single argument: measured against tmux 3.7b,
// 16,250 bytes in one argument was accepted and 16,375 refused, and two 10,000-byte arguments were
// refused together. So the budget is shared with the socket path, the conf path, the session name,
// `-c <cwd>`, every `-e KEY=VALUE` (muse's plugin env) and the bin's own flags. Windows brings its
// own, smaller ceiling — cmd.exe stops at 8,191 characters.
//
// Gating on the SEED's size alone is still enough, because the seed is the only part of that line
// with no bound: everything else is a path, a flag or a uuid, and together they run to hundreds of
// bytes. A seed held to the budget below leaves the total far short of either ceiling.
//
// BYTES, not characters. tmux counts bytes and Japanese is three of them per character, so a
// 3,000-character seed is 9,000 bytes — a character-count guard would wave it straight through.
//
// Windows counts the other way round, and it counts what cmd.exe is HANDED, not what we hold: a
// `.cmd` shim is run through `cmd /d /s /c "…"`, and escapeBatchArgument doubles every internal
// quote on the way there. A seed of nothing but quotes therefore arrives at twice the size we
// measured — 4,096 of them become 8,192 characters, past cmd's 8,191 ceiling, and the session does
// not start. So the Windows arm measures the ESCAPED argument (codex review on #1522). Its unit is
// characters because cmd's limit is; the newline test runs first, so nothing that would make
// escapeBatchArgument throw ever reaches it.
export const SEED_ARGV_MAX_BYTES = 4096;
const seedNeedsFile = (prompt: string, platform: NodeJS.Platform): boolean => {
  if (platform === "win32") return /[\0\r\n]/.test(prompt) || escapeBatchArgument(prompt).length > SEED_ARGV_MAX_BYTES;
  return Buffer.byteLength(prompt, "utf8") > SEED_ARGV_MAX_BYTES;
};

export function seedPromptArgument(sessionId: string, prompt: string, platform: NodeJS.Platform = process.platform): string {
  if (!seedNeedsFile(prompt, platform)) return prompt;
  const file = writePrivate(seedPromptFile(sessionId), prompt);
  // One line, and it names the file rather than describing it: an agent that reads nothing else
  // still has the path. "first task" rather than "prompt" because the file IS the turn to run.
  return `Your first task is written in this file — read it and carry it out: ${file}`;
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
  removeQuietly(appendedPromptFile(sessionId));
  removeQuietly(seedPromptFile(sessionId));
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

// Every name a session writes here, WHOLE — not a set of extensions crossed with a set of
// suffixes. `<id>` is always a session id (every caller takes one from randomUUID() or a
// SESSION_ID_RE match), and requiring the exact shape is what keeps this from deleting a file that
// merely happens to end in `.json` or `.txt`: the directory is ours, but "ours" is not a good
// enough reason to remove something we did not write. A cross-product would have swept `<id>.txt`,
// which nothing here produces.
//
// A file kind missing from this list is one nothing ever collects — which is what a `.json`-only
// rule did to the prompt file (#1516). Add the kind here when you add the writer.
const FILE_ENDINGS = [".json", "-mcp.json", "-prompt.txt", "-seed.txt"] as const;

function sessionIdFromFileName(name: string): string | null {
  // First ending whose remainder is a session id wins: `<id>-mcp.json` also ends in `.json`, and
  // the id check is what rejects that reading before `-mcp.json` gets its turn.
  for (const ending of FILE_ENDINGS) {
    if (!name.endsWith(ending)) continue;
    const id = name.slice(0, -ending.length);
    if (SESSION_ID_RE.test(id)) return id;
  }
  return null;
}
