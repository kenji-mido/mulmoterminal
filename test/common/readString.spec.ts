// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readString, describeValue } from "../../common/readString.js";

describe("readString", () => {
  it("answers the string itself", () => {
    expect(readString("collections")).toBe("collections");
    expect(readString("")).toBe("");
  });

  // The whole point: `String({})` is "[object Object]", which then travels as a slug that matches
  // nothing rather than as an obviously-absent one.
  it('never produces "[object Object]" for the shapes String() would', () => {
    for (const value of [{}, { a: 1 }, [1, 2], null, undefined, 42, true, () => 1]) {
      expect(readString(value)).toBe("");
    }
    expect(String({})).toBe("[object Object]"); // what it replaces
  });
});

describe("describeValue", () => {
  // Here the input is bad by definition — the message names what was rejected — so the shape has
  // to stay visible.
  it("keeps the shape visible instead of flattening it", () => {
    expect(describeValue({ a: 1 })).toBe('{"a":1}');
    expect(describeValue([1, 2])).toBe("[1,2]");
    expect(describeValue("plain")).toBe("plain");
    expect(describeValue(null)).toBe("null");
  });

  it("survives a circular structure, which JSON.stringify throws on", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => JSON.stringify(loop)).toThrow();
    expect(describeValue(loop)).toBe("[unserializable]");
  });

  it("answers a string for a value JSON.stringify returns undefined for", () => {
    expect(describeValue(undefined)).toBe("undefined");
  });
});
