// Setting a session aside, or removing it for good, from the launcher's "or resume here" rows.
//
// These two buttons used to live on the chat sidebar's session rows. Upstream #1201 deleted the
// single terminal view and that sidebar with it, which left the routes, the hidden-store and the
// transcript deleter all intact and nothing able to reach them. The resume list is where a session
// the user is done with is now SEEN, so it is where they are put back.
//
// Its own module for the same reason useSessionStop is: what each one ends is a different thing,
// and that distinction is the whole feature. Hide keeps the conversation and only stops offering
// it; delete removes the transcript, so `claude --resume` cannot find it either.
import { ref } from "vue";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

/** The little a row must carry to be hidden or deleted: what to say, and which session. */
export interface HideableRow {
  id: string;
  title: string;
}

export const deleteSessionPrompt = (title: string): string =>
  `Delete "${title}" permanently? This removes the conversation transcript from disk — it cannot be undone, and the session will no longer be resumable anywhere.`;

/**
 * `onChanged` re-reads the list rather than this patching a row out of it, for the same reason the
 * stop button does: what is listed is the server's answer, and a row removed here would disagree
 * with it the moment anything else changes.
 */
export function useSessionHideDelete(onChanged: () => Promise<void> | void) {
  // The row being acted on, so its buttons can show the wait and a second click cannot fire a
  // second request at a session the first one is already removing.
  const busyId = ref<string | null>(null);

  async function post(row: HideableRow, action: "hide" | "delete"): Promise<void> {
    busyId.value = row.id;
    try {
      await fetchWithTimeout(`/api/session/${encodeURIComponent(row.id)}/${action}`, { method: "POST" }, SLOW_COMMAND_TIMEOUT_MS);
    } catch (err) {
      // Nothing to tell the user that the refreshed list will not: if it failed, the row is still
      // there with its buttons.
      console.warn(`[session-${action}] failed:`, err);
    } finally {
      busyId.value = null;
      await onChanged();
    }
  }

  /** Stop offering this session. The transcript is kept, so `claude --resume` still finds it —
   *  nothing is destroyed, which is why this one does not ask first. */
  async function hideSession(row: HideableRow): Promise<void> {
    if (busyId.value !== null) return;
    await post(row, "hide");
  }

  /** Remove the transcript. Irreversible, hence the confirmation — the same shape the stop button
   *  uses, so the two destructive-ish actions on this row ask in the same way. */
  async function deleteSession(row: HideableRow): Promise<void> {
    if (busyId.value !== null) return;
    if (!window.confirm(deleteSessionPrompt(row.title))) return;
    await post(row, "delete");
  }

  return { busyId, hideSession, deleteSession };
}
