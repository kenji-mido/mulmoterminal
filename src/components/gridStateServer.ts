// Server-side mirror of the grid layout (GET/POST /api/grid-state), so a SECOND browser
// — a phone over Tailscale, an SSH forward — reconstructs the same grid instead of the
// empty one localStorage alone gives a fresh client. The running sessions are alive and
// reattachable server-side; this is what lets a new browser SEE which cells to show.
//
// localStorage stays the fast local cache and the authority for a browser that already has
// a grid; the server is consulted only to seed a fresh client (see GridView), and is kept
// current by a debounced mirror of every change.
import { parseGridState, type GridState } from "./gridTabs";

// Validate a raw grid blob (a fetch response's `state`, or a pub/sub payload) through the SAME
// validator the localStorage path uses — the client owns the schema. Null when absent/invalid.
export function parseServerGridState(state: unknown): GridState | null {
  if (state == null) return null;
  return parseGridState(JSON.stringify(state));
}

// The canonical, comparable form of a grid: only the persistent SESSION cells (parseGridState
// drops the transient launch/command cells and renumbers uids). Sync keys off this so opening
// the launcher's "+" cell — which adds a session-less cell — is NOT a change to broadcast, and
// a peer's echo can't wipe that half-filled cell back out.
//
// The raw variant takes an already-stringified grid, so a caller that just serialized the
// state (persist writes it to localStorage anyway) doesn't stringify it a second time.
export function normalizeRawGridJson(raw: string): string {
  const parsed = parseGridState(raw);
  return parsed ? JSON.stringify(parsed) : raw;
}

export function normalizedGridJson(state: GridState): string {
  return normalizeRawGridJson(JSON.stringify(state));
}

// Fetch the shared grid. "The server has no saved grid" (ok + null state — the caller may
// seed it) is a DIFFERENT answer from "the request failed" (ok:false — a flaky link over
// Tailscale, a 5xx): a fresh browser whose first GET merely failed must NOT conclude the
// server is empty and seed its own empty grid, which would broadcast and wipe every open
// browser's cells. A saved-but-unparsable blob counts as "no saved grid" — overwriting
// garbage with a valid seed is fine.
export type GridStateFetch = { ok: true; state: GridState | null } | { ok: false };
export async function fetchServerGridState(): Promise<GridStateFetch> {
  try {
    const res = await fetch("/api/grid-state");
    if (!res.ok) return { ok: false };
    const body = await res.json();
    return { ok: true, state: parseServerGridState(body?.state) };
  } catch {
    return { ok: false };
  }
}

// Debounced so a burst of reactive changes (a drag, a page of cells launching) collapses to
// one write. Fire-and-forget: a failed mirror just means the other browser seeds a beat
// later; localStorage already holds the authoritative local copy.
let timer: ReturnType<typeof setTimeout> | null = null;
export function saveServerGridState(state: GridState, delayMs = 800): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fetch("/api/grid-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    }).catch(() => {});
  }, delayMs);
}
