import { ref, watch } from "vue";
import { isTouchDevice } from "./touchDevice";

// Whether the on-screen key bar + text field show below the terminal. App-wide and persisted:
// touch auto-detect is only the DEFAULT — a device where it misreads (some mobile browsers) can
// still summon the bar from the terminal header's ⌨ toggle, and the choice sticks across reloads.
const KEY = "mobileKeys";

function initial(): boolean {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  if (stored !== null) return stored === "1";
  return isTouchDevice();
}

const enabled = ref(initial());
watch(enabled, (v) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, v ? "1" : "0");
});

export function useMobileKeys() {
  return enabled;
}
