// Refresh on mount, whenever the user comes back to this tab, and on a slow tick — but only while
// the tab is actually visible, so a backgrounded grid of cells is not polling the server per cell.
//
// **Both** returning signals are needed, and that is the part worth stating: switching between
// browser TABS fires `visibilitychange` and not `focus`, while switching between windows or apps
// fires `focus`. Listening to one leaves the other showing whatever it last fetched until the next
// tick — which is how a returning tab sat on a stale PR phase for most of a minute (found in review
// on `useWorkItem`, and `useGitStatus` had the same gap until this was shared).
//
// `remoteHostSelfHeal.ts` deliberately does NOT use this: it is not a composable (it returns its own
// cleanup rather than binding to a component's lifetime), it also heals on `online` and on a socket
// reconnect, and its tick is unconditional because a heal is a no-op when already connected.
import { onMounted, onUnmounted } from "vue";

export function usePollWhileVisible(refresh: () => void, intervalMs: number): void {
  const refreshIfVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    refresh();
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    timer = setInterval(refreshIfVisible, intervalMs);
  });
  onUnmounted(() => {
    window.removeEventListener("focus", refreshIfVisible);
    document.removeEventListener("visibilitychange", refreshIfVisible);
    if (timer) clearInterval(timer);
  });
}
