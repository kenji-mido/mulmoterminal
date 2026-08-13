// Turning a domain value into the JSON the remote-host channel actually sends.
//
// `toJsonObject` (from @mulmoclaude/core/remote-host) takes `Jsonify<T>`, which a payload built
// from collection types cannot satisfy: `CollectionItem` and `RemoteViewPage` carry
// `unknown`-valued index signatures, and `unknown` is not provably JSON. Three handlers therefore
// asserted their way to `JsonObject`, one of them through `as unknown as` — the shape simply does
// not overlap.
//
// This CONVERTS instead of asserting, so the claim becomes true rather than declared.
//
// It runs the payload through JSON.stringify + JSON.parse rather than reimplementing what
// stringify does. That is the whole design: the value is about to be stringified onto the wire
// anyway, so the round trip yields EXACTLY what the client would have received — by construction,
// not by imitation. An earlier version walked the value itself and had to be corrected four times
// over (`"__proto__"` keys, `Date`/`toJSON`, the property key handed to `toJSON`, boxed
// primitives), each one a place where the imitation had drifted from the original. Nothing here
// can drift, because the only thing deciding is stringify.
//
// The walk below therefore only ever sees the output of JSON.parse — null, string, number,
// boolean, array, plain object — which is the whole of JsonValue. There is no other case.
import { isRecord } from "../../../common/isRecord.js";
import type { JsonObject, JsonValue } from "@mulmoclaude/core/remote-host";

/** Already-parsed JSON, retyped by inspection. Total: JSON.parse produces nothing else. */
function fromParsed(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(fromParsed);
  if (isRecord(value)) return recordFromParsed(value);
  // Unreachable for JSON.parse output; null keeps the function total rather than asserting.
  return null;
}

function recordFromParsed(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    // defineProperty, not `out[key] =`: a payload carrying a literal `"__proto__"` key would
    // otherwise assign the object's PROTOTYPE and the key would vanish from the output — while
    // JSON keeps it as an ordinary key (Codex review on #1288).
    Object.defineProperty(out, key, { value: fromParsed(entry), writable: true, enumerable: true, configurable: true });
  }
  return out;
}

/**
 * A payload as the JSON the channel will send.
 *
 * Throws whatever JSON.stringify throws — a bigint anywhere in the payload, a circular reference —
 * rather than quietly shipping a value with a field missing.
 *
 * Named apart from core's `toJsonObject`, which two of the callers also import.
 */
export function jsonPayload(value: Record<string, unknown>): JsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return isRecord(parsed) ? recordFromParsed(parsed) : {};
}
