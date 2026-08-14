// Reading a few numbers out of a protobuf record whose schema we do not have.
//
// agy stores its per-generation accounting as protobuf blobs in a SQLite database
// (antigravity-usage.ts). There is no .proto anywhere on disk, so a field is addressed by NUMBER
// and its meaning was established by watching it: `1.9.10.1` climbs to 252,780 against `1.9.10.4`
// = 256,000 and drops when the conversation compacts, which is a context reading and nothing else.
//
// That is a fine way to learn a format and a terrible thing to trust blindly, so this walker is
// built to fail rather than to guess:
//
//   - it NEVER throws — a truncated blob, a wrong wire type, a field that is a string where a
//     message was expected, all answer `undefined`, and the caller shows no badge;
//   - it reads only the path it is asked for, skipping every other field by its length, so a
//     740 KB row costs a few dozen byte reads rather than a full decode;
//   - it stops at the first byte it cannot account for, rather than resynchronising — a walker
//     that recovers from garbage is a walker that reports numbers from garbage.
//
// The caller is where the numbers are sanity-checked. Nothing here knows what a plausible token
// count is; it only knows what a varint is.

/** A protobuf varint at `offset`: where the next field starts, and its value — `null` when the
 *  value is real but too large for a JS number to hold exactly.
 *
 *  Those two are deliberately separate answers. agy's rows carry a `18446744073709551615` sentinel
 *  in the message that also holds the context reading, and a walker that treats "cannot represent
 *  this" as "cannot continue" stops there and reports no context at all — which is precisely what
 *  the first cut did against the real database, while every synthetic fixture passed. Skipping a
 *  field never needs its value. */
interface Varint {
  value: number | null;
  next: number;
}

// 10 bytes is the most a 64-bit varint can occupy. A longer run means the blob is not what we
// think it is, which is a stop rather than a number.
const MAX_VARINT_BYTES = 10;
// Beyond 2^53 a JS number stops counting exactly. Nothing we read is anywhere near it — a token
// count or a byte length — so a value that big is a misread field, not a big number.
const MAX_EXACT = Number.MAX_SAFE_INTEGER;

function readVarint(buf: Buffer, offset: number): Varint | null {
  let value = 0;
  let shift = 1;
  let exact = true;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    const at = offset + i;
    if (at >= buf.length) return null; // truncated: the blob really does end mid-field
    const byte = buf[at] ?? 0;
    value += (byte & 0x7f) * shift;
    if (value > MAX_EXACT) exact = false;
    if ((byte & 0x80) === 0) return { value: exact ? value : null, next: at + 1 };
    shift *= 128;
  }
  return null; // an eleventh continuation byte: not a varint, so not this format
}

/** A field key: its number and wire type, or null if the key itself is unreadable. A key is small
 *  by construction, so one that is not exact is a blob we are not reading. */
function readKey(buf: Buffer, offset: number): { field: number; wireType: number; next: number } | null {
  const key = readVarint(buf, offset);
  if (key?.value === null || key === null) return null;
  return { field: Math.floor(key.value / 8), wireType: key.value % 8, next: key.next };
}

/** One field: what it is, what it holds, and where the next one starts. Null means the bytes here
 *  are not a field, which ends the walk — a group, a wire type that does not exist, or a payload
 *  claiming to run past the end of the buffer. */
interface Field {
  field: number;
  varint: number | null | undefined;
  bytes: Buffer | undefined;
  next: number;
}

const FIXED64_BYTES = 8;
const FIXED32_BYTES = 4;

/** A field whose payload fits inside the buffer, or null when it claims to run past the end. */
const endWithin = (buf: Buffer, field: Omit<Field, "next">, next: number): Field | null => (next <= buf.length ? { ...field, next } : null);

function readField(buf: Buffer, offset: number): Field | null {
  const key = readKey(buf, offset);
  if (!key) return null;
  const skipped = { field: key.field, varint: undefined, bytes: undefined };
  if (key.wireType === 0) {
    const value = readVarint(buf, key.next);
    return value && { field: key.field, varint: value.value, bytes: undefined, next: value.next };
  }
  if (key.wireType === 2) {
    const length = readVarint(buf, key.next);
    if (length?.value == null) return null;
    const end = length.next + length.value;
    if (end > buf.length) return null;
    return { field: key.field, varint: undefined, bytes: buf.subarray(length.next, end), next: end };
  }
  // Bounds-checked like every other width here. It changes no answer today — a fixed-width field
  // carries neither a varint nor bytes, so the callback records nothing and the walk ends on the
  // next loop test either way — but "stop at the first byte you cannot account for" has to hold
  // for every wire type, or the first reader to report a fixed-width value inherits the hole.
  if (key.wireType === 5) return endWithin(buf, { ...skipped }, key.next + FIXED32_BYTES);
  if (key.wireType === 1) return endWithin(buf, { ...skipped }, key.next + FIXED64_BYTES);
  return null;
}

/**
 * Walk `buf`'s fields, handing each one to `onField`, until the bytes stop making sense.
 *
 * `onField` gets the field number and, for a varint, its value (null when the value is beyond a JS
 * number — the field is still SKIPPED correctly, which is the whole point). Length-delimited
 * payloads arrive as a subarray. Everything else is stepped over by its fixed width.
 */
function walkFields(buf: Buffer, onField: (field: number, varint: number | null | undefined, bytes: Buffer | undefined) => void): void {
  let offset = 0;
  while (offset < buf.length) {
    const field = readField(buf, offset);
    if (!field) return;
    onField(field.field, field.varint, field.bytes);
    offset = field.next;
  }
}

/** The bytes of length-delimited field `field` inside `buf`, or undefined if it holds no such
 *  field. The LAST one wins, matching protobuf's own rule for a repeated-or-overwritten field. */
function messageField(buf: Buffer, field: number): Buffer | undefined {
  let found: Buffer | undefined;
  walkFields(buf, (at, _varint, bytes) => {
    if (at === field && bytes) found = bytes;
  });
  return found;
}

/** The varint value of field `field` in `buf`, or undefined — including when the field is there but
 *  too large to hold exactly, which is not a number we may report. */
function varintField(buf: Buffer, field: number): number | undefined {
  let found: number | undefined;
  walkFields(buf, (at, varint) => {
    if (at === field && varint !== undefined) found = varint ?? undefined;
  });
  return found;
}

/**
 * The varint at a path of field numbers — `[1, 9, 10, 1]` for `1.9.10.1`. Every step but the last
 * must be a length-delimited field holding a message; the last must be a varint. Anything else,
 * at any depth, is `undefined`.
 */
export function protoVarintAt(blob: Buffer, path: readonly number[]): number | undefined {
  if (path.length === 0) return undefined;
  let cursor: Buffer | undefined = blob;
  for (const field of path.slice(0, -1)) {
    cursor = messageField(cursor, field);
    if (!cursor) return undefined;
  }
  const leaf = path[path.length - 1];
  return leaf === undefined ? undefined : varintField(cursor, leaf);
}

/** Several varints under one shared prefix, read in a single descent. `undefined` for any leaf the
 *  record does not carry — which a caller must treat as "not this shape", not as zero. */
export function protoVarintsAt(blob: Buffer, prefix: readonly number[], leaves: readonly number[]): (number | undefined)[] {
  let cursor: Buffer | undefined = blob;
  for (const field of prefix) {
    cursor = messageField(cursor, field);
    if (!cursor) return leaves.map(() => undefined);
  }
  const at = cursor;
  return leaves.map((leaf) => varintField(at, leaf));
}
