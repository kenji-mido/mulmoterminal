// One task at a time per key, for the operations whose correctness is read-modify-write: two runs
// that overlap each read the world before either has changed it, and the second undoes the first.
//
// A LOCK, not a shared result — callers for one key get their own turn rather than the answer the
// first one got. That is what lets a queued caller re-check the world (a memo, the remote's own
// state) and do something different, or nothing at all.
export type SerializePerKey = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeySerializer(): SerializePerKey {
  const chains = new Map<string, Promise<unknown>>();

  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    // `.then(task, task)` on both settlements: a failed run must not stop the queue behind it.
    const run = (chains.get(key) ?? Promise.resolve()).then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, settled);
    // Dropped only if nothing queued behind it, so the map does not grow with every call and a
    // later waiter is never orphaned.
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return run;
  };
}
