import { isObject } from "graphai";

// The guard both sides use before reading named fields off parsed JSON (config files, API
// responses, JSONL transcripts, request bodies). It was hand-copied into 29 files before this.
//
// Arrays are excluded deliberately, and that is not a nicety: TypeScript itself refuses
// `const r: Record<string, unknown> = []` ("index signature for type 'string' is missing"), so a
// guard that narrows an array to Record is telling the compiler something untrue — and callers
// that go on to `Object.entries()` the value would silently walk array indices as field names.
//
// graphai's own `isPlainObject` is exactly this (it also rejects Map/Date/class instances), but
// it is not exported from the package root, so the array check stays here.
export const isRecord = (value: unknown): value is Record<string, unknown> => isObject(value) && !Array.isArray(value);

// "Absent, or of this type" — what an OPTIONAL field on a wire shape has to satisfy. A guard that
// skips these asserts a type it has not seen: absent is meaningful (an older server never said the
// field), but a present one of the wrong type is a lie the rest of the code then reads.
export const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
export const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === "boolean";
