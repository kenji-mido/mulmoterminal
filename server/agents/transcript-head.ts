// Reading a title out of the front of an agent's own JSONL transcript.
//
// codex rollouts and agy conversations record different things in different shapes, but the
// listing job is the same one twice: read a bounded head (never the whole file — an agent appends
// to these without limit), pick the first line that is a user turn, and turn it into a row title.
import { open } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";

const TITLE_MAX = 60;

/** One JSONL line as a record, or null for a truncated final line or a non-JSON row. */
export function parseJsonRecord(line: string): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const doc: unknown = JSON.parse(line);
    return isRecord(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** A prompt as a single-line row title, or `fallback` when there is nothing to show. */
export function cleanTitle(raw: string | null, fallback: string): string {
  const title = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return title || fallback;
}

/**
 * The first `headBytes` of a transcript plus its mtime, or null if it cannot be read.
 *
 * Both callers want the mtime from the SAME open handle as the head: a file the agent is still
 * appending to can be renamed or removed between a read and a separate stat.
 */
export async function readTranscriptHead(file: string, headBytes: number): Promise<{ head: string; mtime: number } | null> {
  let fh;
  try {
    fh = await open(file, "r");
    const buf = Buffer.alloc(headBytes);
    const { bytesRead } = await fh.read(buf, 0, headBytes, 0);
    const { mtimeMs } = await fh.stat();
    return { head: buf.subarray(0, bytesRead).toString("utf8"), mtime: mtimeMs };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}
