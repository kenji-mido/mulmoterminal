// One slow, side-effecting click at a time.
//
// A button whose handler shells out — `git worktree add` checks out the whole tree, seconds on a
// large repository — stays pressable for the entire round trip unless something says otherwise,
// and a screen that does not change is indistinguishable from a click that did nothing. So it is
// pressed again: #1549 got three worktrees for one task, because every press succeeded.
//
// The rule is not new here — `pickPaths` refuses a second dialog (#1527), the /prs issue row holds
// itself with `starting` (#1219), `useSessionStop` with `stopping` — it just had no shared home,
// which is how the worktree buttons ended up without it.
import { ref } from "vue";

export function useBusyAction() {
  // The KEY of the action in flight, rather than a flag: several controls share one guard, and the
  // one that was actually pressed is the one that should show the progress. Null means idle.
  const busy = ref<string | null>(null);

  // Exclusive across keys, not per key. Every caller so far runs git in ONE repository, where two
  // concurrent commands contend on the index lock; and "the form is doing something" is a state a
  // user can read, where "these two buttons are live and that one is not" is not.
  async function run(key: string, action: () => Promise<void>): Promise<void> {
    if (busy.value !== null) return;
    busy.value = key;
    try {
      await action();
    } finally {
      // Released even when the action threw, or one failure would leave the form dead with no way
      // back short of a reload.
      busy.value = null;
    }
  }

  return { busy, run };
}
