// @vitest-environment node
import { describe, it, expect } from "vitest";
import { jsonPayload } from "../../../../server/backends/remoteHost/jsonPayload.js";

// The point of this module is that the RESULT equals what the client would have received when the
// payload was asserted to be JSON and stringified. So the yardstick is JSON.stringify itself.
const stringified = (value: Record<string, unknown>): unknown => JSON.parse(JSON.stringify(value));

// A boxed primitive, built without the wrapper constructors the lint rule bans (rightly — they are
// only ever wanted here, as adversarial input).
const boxed = (value: unknown): unknown => Object(value);

describe("jsonPayload", () => {
  it("passes scalars, arrays and nested records through unchanged", () => {
    const value = { s: "a", n: 1, b: true, nul: null, arr: [1, "two", false], deep: { inner: { k: [1, 2] } } };
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("omits keys JSON has no representation for, as stringify does", () => {
    const value = { kept: "yes", fn: () => 1, undef: undefined, sym: Symbol("x") };
    expect(jsonPayload(value)).toEqual({ kept: "yes" });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // Dropping the element instead would shift every later index — a row landing under the wrong
  // one on the phone. stringify writes null for exactly this reason.
  it("writes null for an array element JSON cannot represent, keeping positions", () => {
    const value = { list: [1, () => 2, 3] };
    expect(jsonPayload(value)).toEqual({ list: [1, null, 3] });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("writes null for NaN and Infinity, as stringify does", () => {
    const value = { nan: NaN, inf: Infinity, negInf: -Infinity };
    expect(jsonPayload(value)).toEqual({ nan: null, inf: null, negInf: null });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // The shape the handlers actually hand it: an `unknown`-valued index signature holding JSON.
  it("converts a collection-item-shaped record", () => {
    const item: Record<string, unknown> = { id: "r1", title: "Row", tags: ["a", "b"], meta: { count: 2 } };
    expect(jsonPayload({ op: "update", item })).toEqual({ op: "update", item });
  });

  // A payload carrying a literal "__proto__" key: `out[key] =` would assign the PROTOTYPE and the
  // key would disappear from the output, while JSON.stringify keeps it (Codex review on #1288).
  it("keeps a literal __proto__ key instead of touching the prototype", () => {
    const value: Record<string, unknown> = JSON.parse('{"__proto__": {"polluted": true}, "keep": 1}');
    const out = jsonPayload(value);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(JSON.stringify(out)).toBe(JSON.stringify(stringified(value)));
    // The prototype itself is untouched — nothing leaked onto Object.prototype.
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect("polluted" in {}).toBe(false);
  });

  // stringify calls `toJSON` before looking at own keys, so a Date must become its ISO string.
  // Walking its (empty) key list instead produced `{}` — silent data loss (Codex review on #1288).
  it("serializes a Date through toJSON, as stringify does", () => {
    const value = { when: new Date("2026-08-02T00:00:00Z"), nested: { at: new Date(0) } };
    expect(jsonPayload(value)).toEqual({ when: "2026-08-02T00:00:00.000Z", nested: { at: "1970-01-01T00:00:00.000Z" } });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("serializes a Date inside an array too", () => {
    const value = { list: [new Date(0), 1] };
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // stringify throws rather than skipping, and so must this: dropping the key would ship a
  // payload silently missing a field.
  it("throws on a bigint, as stringify does", () => {
    expect(() => jsonPayload({ n: 1n })).toThrow(TypeError);
    expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
  });

  // An object with no toJSON keeps the walk — Map has no own enumerable keys, so `{}` is right.
  it("gives an empty object for a Map, as stringify does", () => {
    const value = { m: new Map([["a", 1]]) };
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // stringify passes the property key to `toJSON`, so a key-aware serializer must see it — calling
  // it with nothing silently changes the answer (Codex review on #1288).
  it("passes the property key to a key-aware toJSON, as stringify does", () => {
    const value = { a: { toJSON: (k: string) => k }, b: { toJSON: (k: string) => `${k}!` } };
    expect(jsonPayload(value)).toEqual({ a: "a", b: "b!" });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("passes the array index as the key inside an array", () => {
    const value = { list: [{ toJSON: (k: string) => k }, { toJSON: (k: string) => k }] };
    expect(jsonPayload(value)).toEqual({ list: ["0", "1"] });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // Boxed primitives serialize as their primitive. Walking them as objects gave
  // `{"0":"a","1":"b"}` / `{}` / `{}` instead (Codex review on #1288).
  it("unwraps boxed primitives, as stringify does", () => {
    const value = { s: boxed("ab"), n: boxed(3), b: boxed(false) };
    expect(jsonPayload(value)).toEqual({ s: "ab", n: 3, b: false });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("writes null for a boxed non-finite number, as stringify does", () => {
    const value = { n: boxed(NaN) };
    expect(jsonPayload(value)).toEqual({ n: null });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // A boxed BigInt reached the object walk and became `{}` — silent data loss where stringify
  // throws. Going through stringify itself makes that impossible (Codex review on #1288).
  it("throws on a boxed bigint too, as stringify does", () => {
    const value = { n: boxed(1n) };
    expect(() => jsonPayload(value)).toThrow(TypeError);
    expect(() => JSON.stringify(value)).toThrow(TypeError);
  });

  it("throws on a circular reference, as stringify does", () => {
    const value: Record<string, unknown> = { name: "loop" };
    value.self = value;
    expect(() => jsonPayload(value)).toThrow(TypeError);
    expect(() => JSON.stringify(value)).toThrow(TypeError);
  });

  it("is empty for an empty record", () => {
    expect(jsonPayload({})).toEqual({});
  });
});
