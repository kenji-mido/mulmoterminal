import { ref } from "vue";

// Whether a cockpit roster row that is waiting on the user BLINKS (#1131). Default on.
//
// In localStorage rather than config.json for the same reason the terminal's font size and scroll
// speed are: it is a property of the person watching the screen, not of the host. Someone with the
// grid on a second monitor across the room wants the movement; someone with it beside their editor
// may not, and one shared value cannot answer both.
//
// Off does not remove the highlight — the row keeps its amber edge and wash. Only the motion stops.
const STORAGE_KEY = "rosterAlertBlink";
const DEFAULT_BLINK = true;

// Storage access can throw (private mode / storage-blocked contexts), so reading is best-effort.
function loadBlink(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Only the explicit "off" turns it off. An absent, blank or unrecognised value is a user who
    // has never touched the setting, which is the default rather than an error.
    return stored === "off" ? false : DEFAULT_BLINK;
  } catch {
    return DEFAULT_BLINK;
  }
}

const blink = ref<boolean>(loadBlink());

export function useRosterAlert() {
  function setBlink(next: boolean) {
    blink.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // storage blocked: the choice still applies for this session, it just isn't remembered
    }
  }
  return { blink, setBlink };
}
