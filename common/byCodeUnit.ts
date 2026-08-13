// Sort filenames and directory names deterministically.
//
// `.sort()` with no comparator is flagged (sonarjs/no-alphabetical-sort) because the default is
// implementation-defined for non-ASCII. The rule suggests `localeCompare`, which would be WRONG
// here: these are filenames — zero-padded date directories and ISO-stamped rollout files — and
// ordering them by the user's locale makes the answer depend on who is running the app. Code-unit
// order is what the callers actually mean, and it is the same everywhere.
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
