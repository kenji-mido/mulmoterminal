// The beep that could not be played because the AudioContext was not running yet.
//
// Holding it is not an optimisation — it is the fix. A suspended context freezes `currentTime`
// at the moment it was blocked, so every beep scheduled during that window is pinned to the SAME
// instant and they all fire together the moment the context resumes (measured: two beeps a second
// apart both ended at 0.181s). One indistinguishable blast at the user's first click is worse
// than one deliberate one, so nothing is scheduled while blocked and the latest is replayed
// instead — the "notify once when audio becomes available" of #1152.
//
// Only the LATEST is kept on purpose: a beep cannot say WHICH sessions were missed, so replaying
// five of them adds noise and no information. Which sessions were missed is carried by the
// per-session marks in missedAttention.ts instead.

import type { NotifyKind } from "../../common/notifyKinds";

export interface HeldBeep {
  kind: NotifyKind;
  cwd: string | null;
}

export interface BeepQueue {
  hold: (beep: HeldBeep) => void;
  /** The held beep, if any, and forget it. */
  take: () => HeldBeep | null;
  clear: () => void;
}

export function createBeepQueue(): BeepQueue {
  let pending: HeldBeep | null = null;
  return {
    hold: (beep) => {
      pending = beep;
    },
    take: () => {
      const held = pending;
      pending = null;
      return held;
    },
    clear: () => {
      pending = null;
    },
  };
}

/**
 * Whether a beep must be held rather than scheduled. `null` means there is no AudioContext at
 * all (unsupported, or construction threw) — nothing to hold it for, so let the caller try and
 * fail loudly-quietly as before.
 */
export function shouldHoldBeep(state: AudioContextState | null): boolean {
  return state !== null && state !== "running";
}
