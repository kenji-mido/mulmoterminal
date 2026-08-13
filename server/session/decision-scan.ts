// Scanning a project's Claude transcripts for the decisions they hold (#997), separated from the
// HTTP route because the digest writer (#1015) reads the same thing on a timer.
import fs from "node:fs/promises";
import path from "node:path";
import type { DecisionRecord, DecisionsResponse } from "../../common/decisionLog.js";
import { isRecord } from "../../common/isRecord.js";
import { byNewest, copyDecisionState, decisionsOf, emptyDecisionState, foldDecision, type Ask, type DecisionScanState } from "./decisions.js";
import type { FileStamp } from "./file-cache.js";
import { createTranscriptFold } from "./transcript-fold.js";
import { projectSessionsDir } from "./project-dir.js";
import { safeReaddir } from "./session-reads.js";

// A project accumulates a transcript per session, so the newest N is a cap on work per request,
// not a filter anyone would notice: decisions are read newest-first anyway. `scanned` in the
// response says how many were actually read, so a truncated scan is visible rather than implied.
const MAX_TRANSCRIPTS = 200;

// A sidecar is untrusted input whoever wrote it. `input` is the AskUserQuestion call's own argument
// object and may be any JSON at all, so it is the one field with nothing to check.
const isAsk = (value: unknown): value is Ask =>
  isRecord(value) &&
  typeof value.toolUseId === "string" &&
  typeof value.ts === "string" &&
  typeof value.sessionId === "string" &&
  (value.cwd === null || typeof value.cwd === "string") &&
  (value.resultText === null || typeof value.resultText === "string");

const isDecisionState = (value: unknown): value is DecisionScanState =>
  isRecord(value) &&
  Array.isArray(value.asks) &&
  value.asks.every(isAsk) &&
  Array.isArray(value.pending) &&
  value.pending.every((id) => typeof id === "string");

// Reading a transcript is the expensive part and the file is append-only, so the scan is resumed
// from where the last one stopped and kept beside a big file — the same fold the session list, the
// summary, the timeline and the cost roll-up are on (#1377, #1386, #1402). A (mtime, size) memo was
// not enough on its own: the session being written to never matches one, so the project's LARGEST
// transcript was re-read in full every time the digest or the skill asked (2.2 s for 484 MB).
//
// No `cold` shortcut: a decision can sit anywhere in the file, and a question and its answer are
// different records, so neither end of the file can answer for the middle.
const decisionFold = createTranscriptFold<DecisionScanState>({
  kind: "decisions",
  version: 1,
  isValue: isDecisionState,
  empty: emptyDecisionState,
  fold: foldDecision,
  copy: copyDecisionState,
});

interface Transcript {
  file: string;
  sessionId: string;
  stamp: FileStamp;
}

async function transcriptsNewestFirst(dir: string): Promise<Transcript[]> {
  const names = safeReaddir(dir).filter((f) => f.endsWith(".jsonl"));
  const stated = await Promise.all(
    names.map(async (name): Promise<Transcript | null> => {
      const file = path.join(dir, name);
      try {
        const s = await fs.stat(file);
        return { file, sessionId: name.slice(0, -".jsonl".length), stamp: { mtimeMs: s.mtimeMs, size: s.size } };
      } catch {
        return null; // deleted between readdir and stat
      }
    }),
  );
  return stated
    .filter((t): t is Transcript => t !== null)
    .sort((a, b) => b.stamp.mtimeMs - a.stamp.mtimeMs)
    .slice(0, MAX_TRANSCRIPTS);
}

// A transcript that could not be read is reported, not silently treated as one with no decisions:
// the caller cannot otherwise tell a quiet project from a partial answer.
async function decisionsIn(transcript: Transcript): Promise<DecisionRecord[] | null> {
  try {
    return decisionsOf(await decisionFold.read(transcript.file, transcript.stamp), transcript.sessionId);
  } catch {
    return null;
  }
}

// Each scan holds an open read stream, so a cold pass over a project with hundreds of sessions
// would open hundreds at once and can hit the process's file-descriptor limit — where the failure
// lands in the catch above and quietly costs decisions. A small pool keeps the cold pass fast
// (measured: 200 transcripts in ~120ms) without ever holding more than this many descriptors.
const SCAN_CONCURRENCY = 8;

async function mapWithLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i];
      if (item !== undefined) results[i] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function decisionsForCwd(cwd: string, limit: number): Promise<DecisionsResponse> {
  const transcripts = await transcriptsNewestFirst(projectSessionsDir(cwd));
  const perFile = await mapWithLimit(transcripts, SCAN_CONCURRENCY, decisionsIn);
  const read = perFile.filter((found): found is DecisionRecord[] => found !== null);
  return {
    decisions: read.flat().sort(byNewest).slice(0, limit),
    scanned: read.length,
    unreadable: perFile.length - read.length,
  };
}
