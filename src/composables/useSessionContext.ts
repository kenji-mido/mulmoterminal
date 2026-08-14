// Fetches a session's running model + current-turn context size from /api/session/:id.
// Used where only the model/context is needed (e.g. header `${model}` substitution). Components that
// also need live activity/usage (TerminalCell) fetch the same endpoint alongside those concerns.
import { ref, type Ref } from "vue";
import type { TerminalAgent } from "../../common/sessionAgent";
import type { SessionContextInfo } from "../../common/sessionContext";
import { useAutoRefresh } from "./useAutoRefresh";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

export type SessionContext = SessionContextInfo;

const isContext = (c: unknown): c is SessionContext => typeof c === "object" && c !== null && "contextTokens" in c;

// `agent` because the model is read from that agent's own log (#1465); omitted means Claude,
// which is what the route defaults to.
export function useSessionContext(sessionId: Ref<string | null>, cwd: Ref<string | null>, agent?: Ref<TerminalAgent>) {
  const context = ref<SessionContext | null>(null);
  let requestSeq = 0;
  // What `context` currently reflects — the session AND the agent it was read from, because the
  // two decide the answer together: the same id asked about a different agent is read from a
  // different log entirely.
  let loadedFor: string | null = null;

  async function refresh(): Promise<void> {
    const id = sessionId.value;
    const key = `${agent?.value ?? "claude"} ${id ?? ""}`;
    if (!id) {
      context.value = null;
      loadedFor = null;
      return;
    }
    // Switched to a different session — or to another agent on the same one: drop the old model
    // now, so a slow/failed fetch can't keep showing the previous one. A refresh of the same pair
    // keeps the last value (no flicker).
    if (loadedFor !== key) {
      context.value = null;
      loadedFor = null;
    }
    const params = new URLSearchParams({ agent: agent?.value ?? "claude" });
    if (cwd.value) params.set("cwd", cwd.value);
    const seq = ++requestSeq;
    try {
      const res = await fetchWithTimeout(`/api/session/${id}?${params}`);
      if (seq !== requestSeq || !res.ok) return;
      const data = await jsonBody(res);
      // Guard against a stale response: the terminal may have switched session mid-flight.
      if (seq === requestSeq && id === sessionId.value && isContext(data.context)) {
        context.value = data.context;
        loadedFor = key;
      }
    } catch {
      // best-effort — `${model}` just renders empty until a later fetch succeeds
    }
  }

  // `agent` is a dependency, not just a query param: it names the reader on the server, so a cell
  // relaunched on another agent would otherwise wear the previous agent's badge until the session
  // or directory happened to change.
  useAutoRefresh(refresh, agent ? [sessionId, cwd, agent] : [sessionId, cwd]);

  return { context, refresh };
}
