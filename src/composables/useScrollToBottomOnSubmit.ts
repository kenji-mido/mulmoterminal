import { ref } from "vue";

// Whether pressing Enter takes a scrolled-up terminal back to the latest output.
//
// A shell cell already does this and always has — it has no mouse tracking, so the wheel puts
// tmux into copy-mode and Enter is copy-mode's own cancel. A full-screen agent (Claude Code sets
// mouse tracking 1003 AND the alternate buffer, measured with `tmux list-panes`) takes the wheel
// itself, so the scroll position belongs to the AGENT: there is no xterm scrollback to return to,
// `scrollToBottom()` is a no-op, and the agent does not go back on submit — not here and not in a
// plain terminal either. What this app can do is unwind the scroll it performed, because it is the
// side that synthesized the wheel reports in the first place (see terminalMouseInput).
//
// On by default: every ordinary terminal returns to the bottom when you type (xterm's `scrollKey`,
// xterm.js's `scrollOnUserInput`), so this is the behaviour a reader expects rather than a new one.
// The switch is for someone who scrolled up deliberately to keep reading while a turn runs.
//
// Per browser, like the scroll SPEED beside it and for the same reason: it is about the device and
// the person in front of it, not about the host.
const STORAGE_KEY = "scrollToBottomOnSubmit";
const DEFAULT_ENABLED = true;

// Storage access can throw (private mode / storage-blocked contexts), so reading is best-effort.
// Only the exact string "0" turns it off: anything else — unset, corrupt, a value written by a
// future version — falls back to the default rather than silently disabling the feature.
function loadEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_ENABLED : stored !== "0";
  } catch {
    return DEFAULT_ENABLED;
  }
}

const enabled = ref<boolean>(loadEnabled());

/** The plain read, for the submit path: it runs per keystroke outside any component, so it wants
 *  the current value rather than a ref to track. */
export const scrollsToBottomOnSubmit = (): boolean => enabled.value;

export function useScrollToBottomOnSubmit() {
  function setScrollToBottomOnSubmit(next: boolean) {
    enabled.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // storage blocked: the choice still applies for this session, just isn't persisted
    }
  }
  return { scrollToBottomOnSubmit: enabled, setScrollToBottomOnSubmit };
}
