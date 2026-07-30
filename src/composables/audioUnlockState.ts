// The AudioContext's state, as something the UI can read.
//
// Split from the player so the toolbar can show "sound is on but the browser is not letting it
// through" without importing the whole notification player — and so the state has one owner
// rather than each surface asking a context it would have to reach for.
//
// `null` is "no context exists yet", which is NOT the same as blocked: nothing has been asked of
// the browser, so claiming the sound is blocked would be a guess. The player creates the context
// as soon as the sound is enabled precisely so this stops being null before the first missed beep.

import { computed, ref } from "vue";

const contextState = ref<AudioContextState | null>(null);

export function setAudioContextState(state: AudioContextState | null): void {
  contextState.value = state;
}

// Anything that is not "running" and not absent. Written as a negation rather than
// `=== "suspended"` because Safari reports "interrupted" (a state not in the TS union) when the
// system takes the audio session away, and that is just as silent.
export const audioBlocked = computed(() => contextState.value !== null && contextState.value !== "running");
