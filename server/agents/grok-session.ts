// Where grok keeps its conversations, and the one question the resume path asks of them.
//
// Unlike codex and antigravity there is nothing to DISCOVER here: grok takes `--session-id <UUID>`
// for a new conversation, so the id is the one this server minted and the directory is named by it
// (verified against grok 0.2.118). All that is left is the cold-resume probe — after a restart the
// browser hands back an id, and this says whether grok still holds a conversation under it.
//
// The layout is `~/.grok/sessions/<encoded cwd>/<uuid>/`, partitioned by WORKING DIRECTORY. That
// partition is why this takes a cwd where the antigravity probe does not: the same id under a
// different directory is a different lookup, and asking without the cwd cannot be answered.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this directory name one of grok's conversations? The listing next door (grok-sessions.ts)
 *  asks it of every entry under a cwd, where `prompt_history.jsonl` and the lock files sit beside
 *  the conversation directories. Exported rather than duplicated: the probe below and the listing
 *  must agree about what an id is, or the list offers a row the resume then declines. */
export const isGrokConversationId = (name: string): boolean => UUID_RE.test(name);

export function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

export function grokSessionsRoot(): string {
  return path.join(grokHome(), "sessions");
}

// How grok names a directory after the cwd it ran in. MEASURED, not guessed — a session started in
// `…/grok enc-test/日本語-dir` produced `…%2Fgrok%20enc-test%2F%E6%97%A5%E6%9C%AC%E8%AA%9E-dir`,
// which is `encodeURIComponent` exactly: `/` and the space escaped, `-` left alone, non-ASCII as
// percent-encoded UTF-8 in upper-case hex.
//
// Getting this wrong is the worst failure this integration has, and it is SILENT: the directory
// simply is not found, the resume is declined, and the user gets a brand-new conversation under an
// id that already had one. Hence the spec that pins all three cases.
export const encodeGrokCwd = (cwd: string): string => encodeURIComponent(cwd);

export const grokSessionDir = (root: string, cwd: string, id: string): string => path.join(root, encodeGrokCwd(cwd), id);

/** Does grok hold a conversation by this id in this directory? The cold-resume probe: after a
 *  restart nothing in memory remembers the session, so this is all that separates a key worth
 *  resuming from a key that only ever named a MulmoTerminal session. */
export function grokConversationExists(root: string, cwd: string, id: string): boolean {
  return UUID_RE.test(id) && existsSync(grokSessionDir(root, cwd, id));
}

/** The same probe with no cwd to ask under: does ANY directory hold a conversation by this id?
 *  The survivor-identity guard (#1537) asks this of a tmux session that outlived a restart,
 *  where the request's cwd is the least trustworthy value on the path — often absent and then
 *  defaulted — so a per-cwd probe would miss the conversation that is right there. One readdir
 *  over the cwd partitions, the same walk claudeOnDiskSessionIds does over claude's projects.
 *  A missing root reads as empty: grok never ran, so nothing is held. */
export function grokConversationExistsInAnyCwd(root: string, id: string): boolean {
  if (!UUID_RE.test(id)) return false;
  let cwds: string[];
  try {
    cwds = readdirSync(root);
  } catch {
    return false;
  }
  return cwds.some((encodedCwd) => existsSync(path.join(root, encodedCwd, id)));
}
