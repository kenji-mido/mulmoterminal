// The sessions that outlived the server, for the Settings list (#1478).
//
// Fetched on demand rather than kept fresh: the answer changes when a session starts, ends or is
// stopped, and the only place it is read is a settings section the user has just opened. `reload`
// is what the stop button calls, so what a row says is always the server's latest answer.
import { ref } from "vue";
import type { SurvivingSession } from "../../common/survivingSessions";
import { isTerminalAgent } from "../../common/sessionAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// Every field the row renders or acts on. `key` above all: it is what the stop button posts to
// `/api/session/:id/terminate`, so a row that cannot name it is not a row worth drawing.
const isSurvivingSession = (row: unknown): row is SurvivingSession =>
  isRecord(row) &&
  typeof row.key === "string" &&
  (row.cwd === null || typeof row.cwd === "string") &&
  (row.agent === null || (typeof row.agent === "string" && isTerminalAgent(row.agent))) &&
  (row.idleSeconds === null || typeof row.idleSeconds === "number") &&
  typeof row.attached === "boolean" &&
  typeof row.resumable === "boolean" &&
  // Required like the rest, and worth saying why: absent would assert as `undefined`, read as
  // false, and quietly drop the "ends at next start" mark from a row the server is about to end —
  // the one thing on this row nobody would think to double-check (Codex on #1486).
  typeof row.reapable === "boolean";

const FETCH_TIMEOUT_MS = 8000;

export function useSurvivingSessions() {
  const sessions = ref<SurvivingSession[]>([]);
  // True until the first answer lands, so "none survived" and "not asked yet" do not look alike —
  // an empty list is the good outcome here and deserves to be said out loud.
  const loading = ref(true);
  const failed = ref(false);

  async function reload(): Promise<void> {
    loading.value = true;
    try {
      const res = await fetchWithTimeout("/api/tmux/sessions", undefined, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`GET /api/tmux/sessions → ${res.status}`);
      const body = await jsonBody(res);
      // A malformed row is dropped rather than asserted: the alternative is a stop button whose
      // key is undefined, posting to `/api/session/undefined/terminate`.
      sessions.value = isUnknownArray(body.sessions) ? body.sessions.filter(isSurvivingSession) : [];
      failed.value = false;
    } catch (err) {
      console.warn("[surviving-sessions] could not read the list:", err);
      sessions.value = [];
      failed.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { sessions, loading, failed, reload };
}
