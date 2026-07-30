// The live set of sessions whose notification was never announced, shared by the player that
// writes it and the cells that render it. A module-level singleton for the same reason
// useSoundEnabled is one: both toolbars and every grid page must agree on it.

import { reactive } from "vue";
import type { MissedMark } from "./missedAttention";

const missed = reactive(new Set<string>());

export function applyMissedMark(id: string, mark: MissedMark): void {
  if (mark === "mark") missed.add(id);
  else if (mark === "clear") missed.delete(id);
}

export function useMissedAttention() {
  return {
    /** Reactive: reading it inside a computed re-runs when the set changes. */
    isMissed: (id: string | null): boolean => (id ? missed.has(id) : false),
    /** The user has looked at this session — the mark has done its job. */
    acknowledge: (id: string | null): void => {
      if (id) missed.delete(id);
    },
  };
}
