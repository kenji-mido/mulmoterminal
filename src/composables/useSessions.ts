import { ref, onMounted, onUnmounted } from "vue";
import { usePubSub } from "./usePubSub";
import type { TerminalAgent } from "../../common/sessionAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// The rows arrive off /api/sessions, so a row becomes a Session only after its three
// load-bearing fields are checked: `id` routes every later request, `title` is rendered, and
// `mtime` decides the sort. A row missing one of them would sort to the top as NaN or route
// nowhere, so it is dropped rather than admitted.
interface SessionRow {
  id: string;
  title: string;
  mtime: number;
}

const isSessionRow = (value: unknown): value is SessionRow =>
  isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.mtime === "number";

const listOfSessionRows = (value: unknown): SessionRow[] => (isUnknownArray(value) ? value.filter(isSessionRow) : []);

const isSession = (value: unknown): value is Session =>
  isRecord(value) && isSessionRow(value) && typeof value.working === "boolean" && typeof value.waiting === "boolean";

const listOfSessions = (value: unknown): Session[] => (isUnknownArray(value) ? value.filter(isSession) : []);

export interface Session {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
  /** The hook that set the current state ("Stop" | "Notification" | …), or null —
   *  splits `waiting` into done (Stop) vs blocked (Notification). */
  event?: string | null;
  /** A background worker: a scheduled collection refresh, or spawnBackgroundChat
   *  hidden:true. Listed under the Background filter rather than among the chats, and
   *  never treated as unread/bold. */
  hidden?: boolean;
  /** The agent this session runs; absent = a Claude session. Drives the row badge and which
   *  agent the single view resumes as. */
  agent?: TerminalAgent;
}

// The session-list chips, mirroring mulmoclaude's history filters: "unread" is a session
// whose `waiting` flag is set, "background" the machine-started workers.
export type Filter = "all" | "unread" | "background";

/** A session that should draw the user's attention (bold + Unread filter): waiting
 *  for input, and not a background worker. */
export function isUnread(s: Session): boolean {
  return !!s.waiting && !s.hidden;
}

/** A session nobody started by hand: a scheduled collection refresh, or a plugin's hidden
 *  spawnBackgroundChat. */
export function isBackground(s: Session): boolean {
  return !!s.hidden;
}

/** Which rows a chip shows. "all" means all CHATS — the background workers are the ones
 *  the user did not start, and letting them share the default list is the clutter this
 *  filter exists to undo (#1060). They stay one click away rather than being dropped:
 *  a MulmoTerminal session is a live terminal, so a row the user cannot reach is also a
 *  process they cannot stop. */
export function matchesFilter(s: Session, filter: Filter): boolean {
  if (filter === "unread") return isUnread(s);
  if (filter === "background") return isBackground(s);
  return !isBackground(s);
}

// Merge a freshly-fetched list into the displayed one while keeping the order
// stable. The server sorts by recency (mtime), so a background update — e.g.
// switching away from a session bumps its file mtime — would reshuffle rows
// under the user and is disorienting. So: existing rows keep their position
// (only their data is refreshed), genuinely-new sessions are prepended (the
// server returns them newest-first), and vanished ones drop out. Callers that
// want a true recency re-sort pass `resort` (the ⟳ button).
export function mergeStable(prev: Session[], incoming: Session[], resort: boolean): Session[] {
  if (resort || prev.length === 0) return incoming;
  const incomingById = new Map(incoming.map((s) => [s.id, s]));
  const prevIds = new Set(prev.map((s) => s.id));
  // flatMap over the lookup: `filter` then `get` made the compiler re-derive that the key is
  // present, which is what the assertion was papering over.
  const kept = prev.flatMap((s) => {
    const fresh = incomingById.get(s.id);
    return fresh ? [fresh] : [];
  });
  const added = incoming.filter((s) => !prevIds.has(s.id));
  return [...added, ...kept];
}

// Shared session-list state for both the vertical Sidebar and the horizontal
// SessionTabBar. Fetches the server's authoritative list and refetches on every
// "sessions" pub/sub push, merging it in without reordering existing rows.
export function useSessions() {
  const sessions = ref<Session[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  // codex sessions (~/.codex) merged alongside Claude's — best-effort, so a codex-endpoint
  // failure never blocks the Claude list. codex activity isn't tracked, so they read as idle.
  async function fetchCodexSessions(): Promise<Session[]> {
    try {
      const res = await fetchWithTimeout("/api/codex/sessions");
      if (!res.ok) return [];
      const data = await jsonBody(res);
      return listOfSessionRows(data.sessions).map((s): Session => ({
        id: s.id,
        title: s.title,
        mtime: s.mtime,
        working: false,
        waiting: false,
        agent: "codex",
      }));
    } catch {
      return [];
    }
  }

  // load() runs on every "sessions" push, so bursts of activity put several in flight at
  // once and they can answer out of order. An older answer applied last reverts titles and
  // ordering to a state the user already saw replaced (#620 F4).
  //
  // The guard compares against what has actually been APPLIED, not against the newest request
  // issued. Comparing against the newest issued discards a perfectly good older answer
  // whenever a newer request fails first — leaving an error banner and an empty list even
  // though valid data arrived (Codex on #628).
  let issuedRequests = 0;
  let lastAppliedRequest = 0;

  async function load(resort = false) {
    const request = ++issuedRequests;
    try {
      const [res, codex] = await Promise.all([fetchWithTimeout("/api/sessions"), fetchCodexSessions()]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await jsonBody(res);
      if (request <= lastAppliedRequest) return; // an equal-or-newer answer is already on screen
      lastAppliedRequest = request;
      const incoming = [...listOfSessions(data.sessions), ...codex].sort((a, b) => b.mtime - a.mtime);
      sessions.value = mergeStable(sessions.value, incoming, resort);
      error.value = null;
    } catch (e) {
      // load() runs on every pub/sub push; a transient refetch failure must not
      // replace an already-populated list with an error banner. Only surface the
      // error when we have nothing to show yet.
      if (sessions.value.length === 0) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      // Only the first load shows the "Loading…" state; later refreshes are
      // silent so the list doesn't flicker.
      loading.value = false;
    }
  }

  // Explicit user action: re-sort the list by recency (server order).
  function refresh() {
    return load(true);
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

  return { sessions, loading, error, load, refresh };
}
