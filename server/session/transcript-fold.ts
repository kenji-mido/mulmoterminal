// Folding a value out of a transcript, once.
//
// A transcript is append-only, so anything derived from it by folding over its records can be kept
// up to date by folding only what arrived since — and that state can be kept beside the file so a
// restart, and the next mulmoterminal process, do not pay for it again. Three readers want exactly
// that (the session list's title fields, a session's cost, its tool timeline), and the wiring is
// the same every time: memory first, disk second, fold the delta, write both back.
//
// Written once here rather than three times, because the interesting part is not the plumbing but
// what each caller has to decide: what a fresh accumulator is, how to fold a record into it, how to
// COPY it (a shared array would be mutated behind the value already handed out), and whether a
// first read of a big file can be answered from less than the whole thing. #1377 / #1386.
import { forEachJsonlRecordIn } from "../infra/jsonl-file.js";
import { createAppendFileCache, type AppendScan, type FileStamp } from "./file-cache.js";
import { createTranscriptSidecar } from "./transcript-sidecar.js";

export interface FoldedAt<T> {
  value: T;
  /** End of the last COMPLETE line — where a later scan resumes. */
  offset: number;
}

export interface TranscriptFoldOptions<T> {
  /** Names the sidecar directory: one per kind of derived value. */
  kind: string;
  /** Bump when `fold` changes what it MEANS — a sidecar written by the old rule outlives a
   *  restart, so it would answer for a rule that no longer exists. */
  version: number;
  /** A sidecar is untrusted input, whoever wrote it. */
  isValue: (value: unknown) => value is T;
  empty: () => T;
  fold: (into: T, record: Record<string, unknown>) => void;
  /** Required, not defaulted to a spread: a value that holds a collection needs that collection
   *  copied too, and getting it wrong mutates a value already handed to a caller. */
  copy: (value: T) => T;
  /** An optional cheaper FIRST read for a big file — the two ends of it, say. Answers null when it
   *  cannot answer exactly, and the whole file is folded instead. */
  cold?: (transcript: string, size: number) => Promise<FoldedAt<T> | null>;
  minBytes?: number;
}

export interface TranscriptFold<T> {
  /** The folded value as of this stamp, paying only for what has not been folded yet. */
  read(transcript: string, stamp: FileStamp): Promise<T>;
}

export function createTranscriptFold<T>(options: TranscriptFoldOptions<T>): TranscriptFold<T> {
  const cache = createAppendFileCache<T>();
  // Spread rather than passed as `minBytes: options.minBytes`: under exactOptionalPropertyTypes an
  // explicit `undefined` is not the same as "not given", and the sidecar's own default is the point.
  const sidecar = createTranscriptSidecar<T>({
    kind: options.kind,
    version: options.version,
    isValue: options.isValue,
    ...(options.minBytes === undefined ? {} : { minBytes: options.minBytes }),
  });

  return {
    async read(transcript, stamp) {
      // Memory first, disk second: the sidecar only has to answer the first read of a file in this
      // process, and after that it is the in-memory scan being resumed.
      const resumed = cache.resume(transcript, stamp) ?? (await sidecar.read(transcript, stamp));
      if (resumed && resumed.from >= stamp.size) {
        cache.set(transcript, stamp, resumed.from, resumed.value);
        return resumed.value;
      }
      const folded = resumed ? await resume(options, transcript, resumed) : await first(options, transcript, stamp.size);
      cache.set(transcript, stamp, folded.offset, folded.value);
      sidecar.write(transcript, stamp, folded.offset, folded.value);
      return folded.value;
    },
  };
}

// The offset came from a previous scan, so it sits on a line boundary and the record starting there
// counts — the one case where a mid-file start must NOT drop its first line.
async function resume<T>(options: TranscriptFoldOptions<T>, transcript: string, from: AppendScan<T>): Promise<FoldedAt<T>> {
  const value = options.copy(from.value);
  const offset = await forEachJsonlRecordIn(transcript, { from: from.from, atLineStart: true }, (record) => options.fold(value, record));
  return { value, offset };
}

async function first<T>(options: TranscriptFoldOptions<T>, transcript: string, size: number): Promise<FoldedAt<T>> {
  const shortcut = await options.cold?.(transcript, size);
  if (shortcut) return shortcut;
  const value = options.empty();
  const offset = await forEachJsonlRecordIn(transcript, {}, (record) => options.fold(value, record));
  return { value, offset };
}
