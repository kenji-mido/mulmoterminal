// Ending a session from a list that only OFFERS sessions — the launcher's "or resume here" rows
// (#1467).
//
// Its own module because the decision is not the markup: what it ends is the running SESSION, not
// the conversation. The transcript stays on disk and the row can be resumed afterwards, which is
// what the confirmation promises; the turn that was in flight is what is actually lost, which is
// why it asks at all.
import { ref } from "vue";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

/** The little a row must carry to be stopped: what to say, and what to stop. */
export interface StoppableRow {
  id: string;
  title: string;
  // The KEY of the running session, which is not always the row's id (common/sessionRunning.ts).
  runningKey?: string | null;
}

export const stopSessionPrompt = (title: string): string =>
  `Stop the session running "${title}"? Its conversation is kept — you can resume it later — but anything it is doing right now is lost.`;

/**
 * `onStopped` re-reads the list rather than this patching the row: what is running now is the
 * server's answer, and a row patched here would disagree with it the moment anything else changes.
 */
export function useSessionStop(onStopped: () => Promise<void> | void) {
  // The row being stopped, so its button can show the wait — and so a second click cannot fire a
  // second terminate at a key the first one is already killing.
  const stopping = ref<string | null>(null);

  async function stopSession(row: StoppableRow): Promise<void> {
    const key = row.runningKey;
    if (typeof key !== "string" || stopping.value !== null) return;
    if (!window.confirm(stopSessionPrompt(row.title))) return;
    stopping.value = row.id;
    try {
      await fetchWithTimeout(`/api/session/${encodeURIComponent(key)}/terminate`, { method: "POST" }, SLOW_COMMAND_TIMEOUT_MS);
    } catch (err) {
      // Nothing to tell the user that the refreshed list will not: if the session survived, its row
      // still says `running` and the button is still there.
      console.warn("[session-stop] terminate failed:", err);
    } finally {
      stopping.value = null;
      await onStopped();
    }
  }

  return { stopping, stopSession };
}
