// Ordering BY directory, for the two places that do it: the grid's "priority" sort and the
// launcher's directory chips. Shared because those two are read side by side — a launcher that
// answered "what does an unset rank mean?" differently would put a project in one place on the
// chips and another in the grid.

// A directory that sets no `orderPriority` sorts after every directory that does, so adding the
// key to ONE project doesn't displace all the others. Infinity rather than a big sentinel: no
// integer a user could write should be able to outrank "unset".
export const UNSET_PRIORITY = Number.POSITIVE_INFINITY;

export const dirPriority = (cwd: string | null, priorityByCwd: Record<string, number>): number =>
  cwd ? (priorityByCwd[cwd] ?? UNSET_PRIORITY) : UNSET_PRIORITY;

// Stable: equal ranks keep their incoming order, so the directories that declare none stay in
// whatever order the caller already holds them in (for the chips, most-recently-used).
//
// Two unset directories subtract to `Infinity - Infinity` = NaN, which is falsy — so that pair
// falls through to the index comparison and keeps its order, which is what the tie is meant to do.
export function orderByDirPriority<T>(items: readonly T[], cwdOf: (item: T) => string | null, priorityByCwd: Record<string, number>): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => dirPriority(cwdOf(a.item), priorityByCwd) - dirPriority(cwdOf(b.item), priorityByCwd) || a.i - b.i)
    .map((x) => x.item);
}
