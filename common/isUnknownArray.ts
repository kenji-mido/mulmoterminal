// The array counterpart to isRecord, and it exists for a reason that is easy to miss:
// `Array.isArray(value)` on an `unknown` narrows it to **`any[]`**, not `unknown[]`. So the
// obvious `Array.isArray(x) ? x : []` hands back an array whose elements are outside the type
// checker entirely, and every read off them type-checks against anything.
//
// Declaring the guard's result as `unknown[]` keeps the elements unverified-but-visible, which is
// what the callers want: they check each element before using it.
export const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);
