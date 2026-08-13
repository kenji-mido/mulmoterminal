// Removing the transcripts the rate-limit probe causes claude to write (#1010).
//
// Hiding them was only ever half an answer: `/api/sessions` is ours to filter, but `claude
// --resume` lists `~/.claude/projects/<cwd>/<id>.jsonl` itself. To keep a probe out of THAT, the
// file has to go.
//
// Two kinds, and only one of them can be named:
//
//   - Probes since the id fix carry an id we chose, so the file is addressed directly. No guessing.
//   - Probes before it let claude mint the id, so nothing about the NAME distinguishes them and
//     the content has to. That is a deletion driven by a guess, which is why the guess is narrow:
//     measured over 7711 transcripts, "contains the probe prompt" matched 6 real conversations
//     (one of them 974 messages long — it merely discussed the string), while "has exactly one
//     user message, and it IS the prompt" matched 83 files and nothing else.
//
// The guess cannot be made perfect, and it is worth saying why rather than implying otherwise: the
// probe types its prompt into the real TUI, so claude records it as `origin: human`,
// `promptSource: typed` — byte for byte what a person typing the same thing produces. No field
// separates them (Codex review on #1030). What bounds the risk instead is TIME: the sweep is for
// files written before this version existed, so it runs ONCE, ever. After that a person can type
// the probe's exact words and nothing will touch it.

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { forEachJsonlLine } from "../infra/jsonl-file.js";
import { encodeProjectDirName, projectSessionsDir } from "../session/project-dir.js";
import { isProbeSessionId } from "./probe-session.js";
import { PROBE_PROMPT } from "./rate-limit-probe.js";
import { isRecord } from "../../common/isRecord.js";

// Every probe transcript measured came in at 87-91KB. The cap is an order of magnitude above that
// so a future, chattier claude still fits, and it exists to keep the sweep from reading a 14MB
// conversation in full. Erring high only ever means leaving litter behind, never deleting work.
export const PROBE_TRANSCRIPT_MAX_BYTES = 1_000_000;

const messageContent = (entry: unknown): { type: string; content: unknown } | null => {
  if (!isRecord(entry)) return null;
  const type = entry.type;
  if (typeof type !== "string") return null;
  const message = entry.message;
  return { type, content: isRecord(message) ? message.content : null };
};

const textOf = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((part): part is { text: string } => isRecord(part) && typeof part.text === "string");
  return texts.length > 0 ? texts.map((part) => part.text).join("") : null;
};

const usesTools = (content: unknown): boolean =>
  Array.isArray(content) && content.some((part) => isRecord(part) && ["tool_use", "tool_result"].includes(String(part.type)));

/** Whether a transcript's CONTENT says a probe wrote it. Pure, so the boundary between "delete
 *  this" and "this is someone's work" is pinned by tests rather than by trying it on a disk.
 *
 *  Deliberately not a substring test: a real conversation that merely QUOTES the prompt has other
 *  user messages, and that is the whole difference. A probe also never reaches for a tool — true
 *  of all 84 probe transcripts measured — so a one-turn conversation that did is somebody's work. */
export function isProbeTranscript(jsonl: string): boolean {
  const scan = newProbeScan();
  for (const line of jsonl.split("\n")) scanProbeLine(scan, line);
  return probeScanVerdict(scan);
}

/** What a transcript has shown so far. Three fields rather than the lines themselves, so a caller
 *  reading a file line by line holds this and nothing else — collecting the lines into an array
 *  first would put the whole transcript in memory, which is the shape of the bug #998 fixed. */
interface ProbeScan {
  users: number;
  said: string | null;
  tool: boolean;
}

const newProbeScan = (): ProbeScan => ({ users: 0, said: null, tool: false });

const scanProbeLine = (scan: ProbeScan, line: string): void => {
  const found = probeEvidenceIn(line);
  if (found === null) return;
  if (found === "tool") {
    scan.tool = true;
    return;
  }
  scan.users++;
  if (scan.users === 1) scan.said = found.said;
};

const probeScanVerdict = (scan: ProbeScan): boolean => !scan.tool && scan.users === 1 && scan.said === PROBE_PROMPT;

/** What one transcript line contributes to the decision: a user's words, the fact that a tool was
 *  used, or nothing worth counting. */
const probeEvidenceIn = (line: string): "tool" | { said: string } | null => {
  if (line.trim() === "") return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null; // a truncated last line is normal for a file still being written
  }
  const message = messageContent(entry);
  if (message === null) return null;
  if (usesTools(message.content)) return "tool";
  if (message.type !== "user") return null;
  const said = textOf(message.content);
  return said === null ? null : { said };
};

/** Delete one probe's own transcript, addressed by the id we gave it. Returns whether a file went.
 *
 *  Refuses any id that is not shaped like a probe's, so the function cannot be turned into a
 *  "delete this user's session" by a future caller passing the wrong variable. */
export async function removeProbeTranscript(cwd: string, sessionId: string): Promise<boolean> {
  if (!isProbeSessionId(sessionId)) return false;
  try {
    await rm(path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`));
    return true;
  } catch {
    return false; // never written, or already gone
  }
}

/** Sweep transcripts left by probes that ran before ids identified them. Returns how many went.
 *
 *  Scoped to ONE project directory because that is where a probe can have written — widening the
 *  scan finds nothing more and puts more of the user's history in front of a delete. */
export async function sweepLegacyProbeTranscripts(cwd: string): Promise<number> {
  const dir = projectSessionsDir(cwd);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return 0; // no transcripts for this project yet
  }
  // One at a time, not Promise.all. This directory holds 454 files on the machine this was written
  // on, and opening them all at once can exhaust the file-descriptor limit — which matters more
  // here than anywhere else, because the sweep gets ONE run: a file skipped by an EMFILE is a file
  // nothing will ever come back for. It runs at startup, off the request path, so it can be slow.
  let removed = 0;
  for (const name of names) {
    if (await removeIfProbe(path.join(dir, name))) removed++;
  }
  return removed;
}

/** Where the "already swept" claim for one workspace lives. Named after the workspace on purpose:
 *  the sweep's scope is a project directory, so the record of having done it has to be per
 *  directory too. A single machine-wide marker would let the FIRST workspace claim it and leave a
 *  second `CLAUDE_CWD` holding its legacy probes forever — half of #1010, silently. */
export const probeSweepMarker = (stateDir: string, cwd: string): string => path.join(stateDir, `probe-sweep-${encodeProjectDirName(path.resolve(cwd))}.json`);

/** The sweep, run at most once per workspace — see the note at the top of this file. Returns the
 *  count, or null when the right to run could not be claimed (already swept, or another process
 *  got there first).
 *
 *  The claim is one exclusive create, and that is the whole mechanism. Not `stat` then write: two
 *  servers starting together would both see no marker and both sweep, and several checkouts DO run
 *  side by side against one `~/.mulmoterminal` (Codex review on #1030). `wx` is O_CREAT|O_EXCL —
 *  the filesystem picks exactly one winner, however many ask.
 *
 *  Claiming before deleting is deliberate in the same way: failing to claim means deleting nothing,
 *  and a crash mid-sweep leaves litter, which is the harmless direction. */
export async function sweepLegacyProbeTranscriptsOnce(cwd: string, stateDir: string): Promise<number | null> {
  const marker = probeSweepMarker(stateDir, cwd);
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(marker, JSON.stringify({ cwd, sweptAt_ms: Date.now() }), { encoding: "utf8", flag: "wx" });
  } catch {
    return null; // already claimed, or the claim cannot be recorded — either way, do not sweep
  }
  return await sweepLegacyProbeTranscripts(cwd);
}

const removeIfProbe = async (file: string): Promise<boolean> => {
  try {
    if ((await stat(file)).size > PROBE_TRANSCRIPT_MAX_BYTES) return false;
    // Line by line into a fixed-size scan, never into a string or an array: taking a whole
    // transcript is the bug #998 fixed, and the size check above is a second guard rather than the
    // only one — a file can grow between the stat and the read.
    const scan = newProbeScan();
    await forEachJsonlLine(file, (line) => scanProbeLine(scan, line));
    if (!probeScanVerdict(scan)) return false;
    await rm(file);
    return true;
  } catch {
    return false;
  }
};
