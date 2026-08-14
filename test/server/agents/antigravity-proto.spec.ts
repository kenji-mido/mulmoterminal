// @vitest-environment node
import { describe, it, expect } from "vitest";
import { protoVarintAt, protoVarintsAt } from "../../../server/agents/antigravity-proto.js";

// The walker reads agy's accounting blobs, for which there is no schema (antigravity-usage.ts).
// Every test here is about the same property: an input that is not exactly the shape we measured
// answers `undefined`, so the caller shows no badge. Nothing may be inferred, recovered or
// resynchronised — a number from a misread field would be rendered as fact.

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
};

const key = (field: number, wireType: number) => varint(field * 8 + wireType);
const varintField = (field: number, value: number): number[] => [...key(field, 0), ...varint(value)];
const bytesField = (field: number, body: number[]): number[] => [...key(field, 2), ...varint(body.length), ...body];
const stringField = (field: number, text: string): number[] => bytesField(field, [...Buffer.from(text, "utf8")]);
const buf = (bytes: number[]) => Buffer.from(bytes);

// `1.9.10.{1,4}` and `1.4.{2,3}` — the real paths, in the real nesting, with unrelated fields
// beside them exactly as agy's rows carry them.
const realShape = buf(
  bytesField(1, [
    ...varintField(3, 1071),
    ...bytesField(4, [...varintField(2, 5907), ...varintField(3, 484), ...varintField(5, 243_385)]),
    ...bytesField(9, [...varintField(2, 18_446_744_073), ...bytesField(10, [...varintField(1, 251_378), ...varintField(4, 256_000)])]),
    ...stringField(19, "gemini-3.6-flash"),
  ]),
);

describe("protoVarintAt", () => {
  it("reads a varint from a nested path", () => {
    expect(protoVarintAt(realShape, [1, 9, 10, 1])).toBe(251_378);
    expect(protoVarintAt(realShape, [1, 9, 10, 4])).toBe(256_000);
    expect(protoVarintAt(realShape, [1, 4, 2])).toBe(5907);
  });

  it("skips the fields around the one it was asked for, whatever their wire type", () => {
    expect(protoVarintAt(realShape, [1, 3])).toBe(1071); // past a nested message and a string
  });

  it("answers undefined for a path the record does not have", () => {
    expect(protoVarintAt(realShape, [1, 9, 10, 7])).toBeUndefined(); // leaf missing
    expect(protoVarintAt(realShape, [1, 9, 11, 1])).toBeUndefined(); // branch missing
    expect(protoVarintAt(realShape, [2, 9, 10, 1])).toBeUndefined(); // root missing
    expect(protoVarintAt(realShape, [])).toBeUndefined();
  });

  it("answers undefined when the path runs through the wrong kind of field", () => {
    expect(protoVarintAt(realShape, [1, 19, 1])).toBeUndefined(); // a string used as a message
    expect(protoVarintAt(realShape, [1, 9, 10])).toBeUndefined(); // a message read as a varint
  });

  // The failure that matters: a renumbered or re-typed field must not be reported as a count.
  it("answers undefined for truncated, empty and non-protobuf input", () => {
    expect(protoVarintAt(realShape.subarray(0, 12), [1, 9, 10, 1])).toBeUndefined();
    expect(protoVarintAt(buf([]), [1])).toBeUndefined();
    expect(protoVarintAt(buf([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), [1])).toBeUndefined();
    expect(protoVarintAt(buf([...key(1, 2), ...varint(9999), 1, 2, 3]), [1, 1])).toBeUndefined(); // length past the end
  });

  it("stops at a fixed-width field whose payload runs past the end", () => {
    // A fixed64 header with only three bytes behind it. What was read BEFORE it still stands; the
    // walk does not continue past a field the buffer cannot contain.
    const short = buf([...varintField(1, 7), ...key(2, 1), 0xaa, 0xbb, 0xcc]);
    expect(protoVarintAt(short, [1])).toBe(7);
    expect(protoVarintAt(short, [2])).toBeUndefined();
  });

  it("stops at a wire type that does not exist instead of resynchronising", () => {
    // Field 1 is a real varint; field 2 claims wire type 6, which protobuf does not define. What
    // follows must not be read, however much it looks like a field.
    const bad = buf([...varintField(1, 42), ...key(2, 6), ...varintField(3, 999)]);
    expect(protoVarintAt(bad, [1])).toBe(42);
    expect(protoVarintAt(bad, [3])).toBeUndefined();
  });

  it("does not lose exactness on a huge varint", () => {
    const huge = buf(varintField(1, Number.MAX_SAFE_INTEGER + 10));
    expect(protoVarintAt(huge, [1])).toBeUndefined();
  });

  // The bug the real database found and every synthetic fixture missed. agy puts a
  // `18446744073709551615` sentinel in the very message that holds the context reading. A walker
  // that stops when it cannot REPRESENT a value never reaches the fields behind it, so the badge
  // reported no context at all while the specs stayed green. Skipping needs no value.
  it("walks past a varint too large to represent and reads the fields behind it", () => {
    const sentinel = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]; // 2^64 - 1
    const withSentinel = buf(bytesField(1, [...bytesField(9, [...key(2, 0), ...sentinel, ...bytesField(10, varintField(1, 251_378))])]));
    expect(protoVarintAt(withSentinel, [1, 9, 10, 1])).toBe(251_378);
    expect(protoVarintAt(withSentinel, [1, 9, 2])).toBeUndefined(); // still not reported as a number
  });
});

describe("protoVarintsAt", () => {
  it("reads several leaves under one prefix in a single descent", () => {
    expect(protoVarintsAt(realShape, [1, 4], [2, 3, 5, 9])).toEqual([5907, 484, 243_385, undefined]);
  });

  it("answers all-undefined when the prefix is not there", () => {
    expect(protoVarintsAt(realShape, [1, 44], [1, 2])).toEqual([undefined, undefined]);
  });
});
