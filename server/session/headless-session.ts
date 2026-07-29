// The session ids MulmoTerminal's own headless `claude -p` runs use — the AI header title and the
// Run menu's Explain — and the cleanup of the transcripts they leave.
//
// Why they need ids at all: a `-p` run is recorded as an ordinary session under the spawn cwd's
// project dir, exactly like a conversation the user had. Without `--session-id` that id is
// claude's alone, so the file can be neither recognised nor addressed — and the roster re-titles a
// viewed session every few turns, so working in the grid buried the chat sidebar under rows
// reading "Below (on stdin) is the recent transcript…", one per title.
//
// Why the id carries a prefix rather than being remembered: a run that the server is killed in the
// middle of (a restart lands mid-title) leaves a transcript nothing in memory can name afterwards.
// Shape survives that; a Set does not — which is the conclusion upstream reached for the
// rate-limit probe's ids (Codex review on #1019).

import { promises as fs } from "node:fs";
import path from "node:path";
import { isInternalSessionId, mintInternalSessionId } from "./internal-session-id.js";
import { projectSessionsDir } from "./project-dir.js";

/** "4ead" for headless. A prefix of its own so a listing filter, and a delete, can tell this kind
 *  from any other internal session even though both are ours. */
export const HEADLESS_SESSION_PREFIX = "f0f0f0f0-4ead-";

/** A fresh id for one headless run. */
export function newHeadlessSessionId(): string {
  return mintInternalSessionId(HEADLESS_SESSION_PREFIX);
}

/** Whether an id belongs to a headless run — used to keep it out of the listings, and to decide
 *  whether a transcript is ours to delete. */
export function isHeadlessSessionId(id: string): boolean {
  return isInternalSessionId(id, HEADLESS_SESSION_PREFIX);
}

/** Delete one headless run's transcript, addressed by the id we gave it. Returns whether a file
 *  went.
 *
 *  Refuses any id that is not shaped like a headless run's, so the function cannot be turned into
 *  a "delete this user's session" by a future caller passing the wrong variable. */
export async function removeHeadlessTranscript(cwd: string, sessionId: string): Promise<boolean> {
  if (!isHeadlessSessionId(sessionId)) return false;
  try {
    await fs.rm(path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`));
    return true;
  } catch {
    return false; // never written, or already gone
  }
}

/** Remove transcripts left by runs that never got to clean up after themselves — the server was
 *  killed mid-title, or the delete failed. Returns how many went.
 *
 *  It needs no content test and no once-ever marker: every file it touches is addressed by a NAME
 *  only this server can mint, so there is no conversation it could mistake for ours. It reads no
 *  file contents at all — just the directory listing — which is why it can run on every boot. */
export async function sweepOrphanHeadlessTranscripts(cwd: string): Promise<number> {
  const dir = projectSessionsDir(cwd);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0; // no transcripts for this project yet
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    if (await removeHeadlessTranscript(cwd, name.slice(0, -".jsonl".length))) removed++;
  }
  return removed;
}
