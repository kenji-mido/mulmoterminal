import { ref, onMounted, onUnmounted } from "vue";
import { usePubSub } from "./usePubSub";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// Only what the favicon reads. /api/sessions carries more per row — title, mtime, agent, hidden,
// the hook that set the state — and every one of them belonged to the session sidebar, which is
// gone (#1201 / #1202). A row missing one of these three cannot be folded into a favicon state at
// all, so it is dropped rather than admitted.
export interface Session {
  id: string;
  working: boolean;
  waiting: boolean;
}

const isSession = (value: unknown): value is Session =>
  isRecord(value) && typeof value.id === "string" && typeof value.working === "boolean" && typeof value.waiting === "boolean";

const listOfSessions = (value: unknown): Session[] => (isUnknownArray(value) ? value.filter(isSession) : []);

// The authoritative session list behind the tab favicon: fetched on mount, refetched on every
// "sessions" push. Replaced wholesale rather than merged in place — `deriveFaviconState` folds the
// whole set, so the order the rows arrive in cannot change what the tab shows.
export function useSessions() {
  const sessions = ref<Session[]>([]);

  // load() runs on every "sessions" push, so bursts of activity put several in flight at
  // once and they can answer out of order. An older answer applied last reverts the favicon
  // to a state it already replaced (#620 F4).
  //
  // The guard compares against what has actually been APPLIED, not against the newest request
  // issued. Comparing against the newest issued discards a perfectly good older answer
  // whenever a newer request fails first — leaving nothing on screen even though valid data
  // arrived (Codex on #628).
  let issuedRequests = 0;
  let lastAppliedRequest = 0;

  async function load() {
    const request = ++issuedRequests;
    try {
      const res = await fetchWithTimeout("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await jsonBody(res);
      if (request <= lastAppliedRequest) return; // an equal-or-newer answer is already applied
      lastAppliedRequest = request;
      sessions.value = listOfSessions(data.sessions);
    } catch {
      // load() runs on every pub/sub push, so a transient failure must leave the last good list
      // in place: blanking it would drop the tab back to idle while sessions are still running.
    }
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;

  onMounted(() => {
    void load();
    unsubscribe = subscribe("sessions", () => void load());
    // pub-sub replays room membership but not events missed while disconnected, so a
    // dropped socket can leave the list stale until the next push — refetch on reconnect.
    offReconnect = onReconnect(() => void load());
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });

  return { sessions, load };
}
