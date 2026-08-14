import type { en } from "./en";

// English is the shape every other bundle has to have. Derived rather than hand-written so the two
// can't disagree: adding a key to `en` makes every other locale a type error until it is translated,
// which is the moment to do it rather than the release after.
//
// The mapped type widens `en`'s literals back to `string` — without it a translation would have to
// be the same English words to satisfy the type.
export type Messages = {
  [Section in keyof typeof en]: Translated<(typeof en)[Section]>;
};

type Translated<T> = T extends string ? string : { [K in keyof T]: Translated<T[K]> };
