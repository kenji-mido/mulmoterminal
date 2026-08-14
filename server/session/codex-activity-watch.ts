// Tail a live codex session's rollout and report each turn boundary it appends.
//
// Polling, not fs.watch: the rollout lives under the user's profile, and on Windows a
// watch opened on an 8.3 short path makes libuv abort() the whole process — uncatchable
// by try/catch, on("error"), or uncaughtException. codex flushes each record immediately
// (measured at 0.5 ms), so a one-second poll costs a negligible amount of detection lag
// and none of that risk.
//
// Every dependency is injected so the loop can be driven with fakes: the real one reads
// the filesystem and mutates session flags, neither of which a test should need.

import { nextReadRange, takeCompleteLines, turnBoundaries, type CodexTurnBoundary } from "../agents/codex-activity.js";

export const CODEX_ACTIVITY_POLL_MS = 1000;

export interface CodexActivityDeps {
  /** Byte length of the rollout, or null while it doesn't exist yet. */
  fileSize: () => Promise<number | null>;
  /** The rollout's bytes in [from, to). */
  readSlice: (from: number, to: number) => Promise<string>;
  onBoundary: (boundary: CodexTurnBoundary) => void;
  /** False once the session's pty is gone — the loop stops on the next tick. */
  isAlive: () => boolean;
  /** Resume only: skip what the rollout already holds. A fresh session starts at 0 so its
   *  first turn isn't missed; a resumed one would otherwise REPLAY every past turn and
   *  leave the cell flagged from history rather than from what is happening now. */
  startAtEnd: boolean;
  /** Reattach only (with startAtEnd): if the skipped content leaves a turn OPEN — its last
   *  boundary is a start without an end — report that one boundary before tailing. The
   *  process behind a reattach is still RUNNING, so an open turn is current fact, not
   *  history: without this a server restarted mid-turn shows an idle cell until the turn's
   *  END arrives (#1538 review). A trailing COMPLETED stays unreported — re-flagging a
   *  days-old finish is the replay startAtEnd exists to prevent. And it must stay false
   *  for a cold resume, where the process is NEW: a trailing start there means the OLD
   *  process died mid-turn, and the resumed one is idle. */
  restoreOpenTurn?: boolean;
  sleep: (ms: number) => Promise<void>;
}

export async function watchCodexActivity(deps: CodexActivityDeps): Promise<void> {
  let offset = deps.startAtEnd ? await startingOffset(deps) : 0;
  let pending = "";
  // Against the SAME offset the tail starts from, so a boundary cannot fall between the
  // restore read and the first poll — it is either in [0, offset) and restored, or after
  // and tailed.
  if (deps.restoreOpenTurn && offset > 0) {
    const skipped = await deps.readSlice(0, offset);
    // The writer is still ALIVE on this path, so the snapshot can land mid-record. Whatever
    // follows the last newline is a record still being written: it is carried as the tail's
    // pending fragment — parsed once its remainder is flushed — never judged as a line here.
    // Both halves of that matter: a torn task_complete judged here would be ignored AND its
    // suffix alone is unparseable on the first poll, so the completion would be lost for good
    // and a restored working flag would stick until some later turn (#1538 review).
    const lastNewline = skipped.lastIndexOf("\n");
    pending = skipped.slice(lastNewline + 1);
    const whole = turnBoundaries(
      skipped
        .slice(0, lastNewline + 1)
        .split("\n")
        .filter((l) => l.trim()),
    );
    if (whole.at(-1) === "started") deps.onBoundary("started");
  }
  while (deps.isAlive()) {
    await deps.sleep(CODEX_ACTIVITY_POLL_MS);
    if (!deps.isAlive()) return;
    const size = await deps.fileSize();
    if (size === null) continue; // rollout not written yet (codex creates it on the first turn)
    const range = nextReadRange(offset, size);
    if (!range) continue;
    if (range.from === 0 && offset > 0) pending = ""; // the file restarted — the fragment is stale
    const taken = takeCompleteLines(pending, await deps.readSlice(range.from, range.to));
    pending = taken.pending;
    offset = range.to;
    turnBoundaries(taken.lines).forEach(deps.onBoundary);
  }
}

// A rollout that doesn't exist yet has no history to skip, so a resume that beat codex to
// the file still starts from 0 and sees its first turn.
const startingOffset = async (deps: CodexActivityDeps): Promise<number> => (await deps.fileSize()) ?? 0;
