// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSessionMeta } from "../../../server/session/session-reads.js";
import { sessionMemos } from "../../../server/session/registry.js";

// The session list reads three fields per transcript — the last ai-title, the last last-prompt and
// the FIRST user message — and used to stream every byte of every file to get them, on every
// request. At 1.1 GB of transcripts that was 4.8 s for a 17 KB answer (#1377).
//
// What is pinned here is that the cheaper reader answers what the unbounded one answered: an
// unchanged file is not re-read, a grown one is caught up, and a file whose fields fall outside the
// cold-read windows is still read whole rather than guessed at.

let dir = "";
let n = 0;

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const userLine = (text: string) => line({ type: "user", message: { content: text } });
const aiTitleLine = (title: string) => line({ type: "ai-title", aiTitle: title });
const promptLine = (text: string) => line({ type: "last-prompt", lastPrompt: text });
// Filler that carries no field the reader folds — a stand-in for the tool output that makes a real
// transcript hundreds of MB.
const fillerLine = (bytes: number) => line({ type: "assistant", text: "x".repeat(bytes) });

function writeTranscript(body: string): { file: string; id: string } {
  const id = `sess-${++n}`;
  const file = `${id}.jsonl`;
  writeFileSync(path.join(dir, file), body);
  return { file, id };
}

const titleOf = async (file: string) => (await readSessionMeta(dir, file)).title;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mt-session-meta-"));
  sessionMemos.clear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readSessionMeta", () => {
  it("reads the last ai-title, falling back through last-prompt to the first user message", async () => {
    const { file } = writeTranscript(userLine("first thing I asked") + aiTitleLine("old title") + aiTitleLine("newest title"));
    expect(await titleOf(file)).toBe("newest title");

    const prompted = writeTranscript(userLine("first thing I asked") + promptLine("what I asked last"));
    expect(await titleOf(prompted.file)).toBe("what I asked last");

    const bare = writeTranscript(userLine("first thing I asked"));
    expect(await titleOf(bare.file)).toBe("first thing I asked");
  });

  // Proven by CHANGING the file behind the reader's back without moving (mtime, size): a reader
  // that still answers the old title cannot have read the bytes.
  //
  // The timestamp is STAMPED rather than captured and put back — utimesSync cannot reproduce an
  // mtime it was given (sub-millisecond precision is lost), so restoring one leaves a different
  // stamp and the reader would re-read for a real reason, testing nothing.
  it("does not read an unchanged transcript twice", async () => {
    const { file } = writeTranscript(userLine("u") + aiTitleLine("AAAA"));
    const full = path.join(dir, file);
    const frozen = new Date(1_700_000_000_000);
    utimesSync(full, frozen, frozen);
    expect(await titleOf(file)).toBe("AAAA");

    const before = statSync(full);
    writeFileSync(full, userLine("u") + aiTitleLine("BBBB")); // same length, different content
    utimesSync(full, frozen, frozen);
    expect(statSync(full)).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });

    expect(await titleOf(file)).toBe("AAAA");
  });

  it("catches up on what was appended, and keeps the first user message across the resume", async () => {
    const { file } = writeTranscript(userLine("the very first prompt"));
    expect(await titleOf(file)).toBe("the very first prompt");

    appendFileSync(path.join(dir, file), userLine("a later prompt") + aiTitleLine("titled after the fact"));
    expect(await titleOf(file)).toBe("titled after the fact");

    // The first user message is what the title falls back to, so a resume that lost it would show
    // the LATER prompt here instead.
    sessionMemos.clear();
    appendFileSync(path.join(dir, file), fillerLine(10));
    const meta = await readSessionMeta(dir, file);
    expect(meta.title).toBe("titled after the fact");
  });

  // Bigger than the cold-read windows (256 KB head + 512 KB tail), with all three fields at the
  // ends — the case the windows exist for.
  it("answers a big transcript from its two ends", async () => {
    const { file } = writeTranscript(userLine("what I asked at the start") + fillerLine(900 * 1024) + aiTitleLine("end title") + promptLine("last prompt"));
    expect(statSync(path.join(dir, file)).size).toBeGreaterThan(768 * 1024);
    expect(await titleOf(file)).toBe("end title");
  });

  // The reason the windows are a fast path and not the answer: this file's ai-title sits in the
  // MIDDLE, out of reach of both. A reader that trusted the windows would report the last-prompt
  // instead and the row would silently change its name.
  it("falls back to the whole file when a field is outside both windows", async () => {
    const body =
      userLine("what I asked at the start") + fillerLine(400 * 1024) + aiTitleLine("buried title") + fillerLine(900 * 1024) + promptLine("last prompt");
    const { file } = writeTranscript(body);
    expect(await titleOf(file)).toBe("buried title");
  });

  // A transcript read while the writer is mid-append ends in half a record. Resuming past that half
  // — from the file's size rather than from the last complete line — would start the next scan
  // inside a line, and the record it becomes would be skipped as broken JSON and never seen.
  it("keeps a record that was still being written when it was first read", async () => {
    const { file } = writeTranscript(userLine("u") + promptLine("what I asked"));
    const full = path.join(dir, file);
    const half = aiTitleLine("titled at last").slice(0, 12);
    appendFileSync(full, half);
    expect(await titleOf(file)).toBe("what I asked");

    appendFileSync(full, aiTitleLine("titled at last").slice(12));
    expect(await titleOf(file)).toBe("titled at last");
  });

  // The flip side of the half-written case: a transcript whose last record simply has no trailing
  // newline. The unbounded reader yields that record, so dropping it here would show a stale title
  // for as long as the file sits unchanged — which is forever, for a session that has ended
  // (CodeRabbit on #1379).
  it("reads a last record that has no trailing newline", async () => {
    const { file } = writeTranscript(userLine("u") + promptLine("what I asked") + aiTitleLine("titled, unterminated").trimEnd());
    expect(await titleOf(file)).toBe("titled, unterminated");
  });

  // Clearing a transcript rewrites it shorter; resuming from the old offset would fold new records
  // onto a value describing a file that no longer exists.
  it("re-reads from the start when the transcript got shorter", async () => {
    const { file } = writeTranscript(userLine("u") + aiTitleLine("first life") + fillerLine(100));
    expect(await titleOf(file)).toBe("first life");

    writeFileSync(path.join(dir, file), userLine("second life"));
    expect(await titleOf(file)).toBe("second life");
  });

  // Only the DISK fields are cached. The memo is the user saying what a session is for, and it
  // changes without the transcript changing at all.
  it("still follows a memo edit while the file is untouched", async () => {
    const { file, id } = writeTranscript(userLine("u") + aiTitleLine("agent's title"));
    expect(await titleOf(file)).toBe("agent's title");

    sessionMemos.set(id, "what I am actually doing");
    expect(await titleOf(file)).toBe("what I am actually doing");
  });
});
