// GET/POST /api/grid-state — the multi-terminal grid layout (which sessions occupy
// which cells, the zoom/page/sort), persisted server-side at ~/.mulmoterminal/
// grid-state.json so a SECOND browser reconstructs the same grid.
//
// Why server-side at all: the grid used to live only in each browser's localStorage,
// so opening the app from a phone (over Tailscale / an SSH forward) showed an EMPTY
// grid even though the sessions were alive and reattachable — you couldn't see them to
// tap them. Mirroring the layout here lets any browser hydrate the same cells.
//
// The body is the client's own GridState blob, stored opaquely — the client is the one
// schema owner (parseGridState re-validates on read), so the server only sanity-checks
// the envelope and caps the size. Last write wins; this is a single-user tool, so a
// desktop and a phone converge rather than needing per-client merge.
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Express, Request } from "express";
import { isRecord } from "../../common/isRecord.js";
import { writeFileAtomic } from "../files/atomic-write.js";

const GRID_STATE_FILE = path.join(os.homedir(), ".mulmoterminal", "grid-state.json");

// A grid is at most 81 cells of small records; 256 KB is generous headroom and still
// bounds what a client can make us parse and hold.
const MAX_BODY_BYTES = 256 * 1024;

// The minimal envelope check: a real GridState always carries a `cells` array. Anything
// else (a truncated body, a stray POST) is rejected rather than persisted, so a later GET
// never hands the client garbage it would just drop anyway.
function looksLikeGridState(v: unknown): v is { cells: unknown[] } {
  return isRecord(v) && Array.isArray(v.cells);
}

function readGridState(): unknown | null {
  try {
    if (!existsSync(GRID_STATE_FILE)) return null;
    const parsed: unknown = JSON.parse(readFileSync(GRID_STATE_FILE, "utf8"));
    return looksLikeGridState(parsed) ? parsed : null;
  } catch {
    return null; // unreadable/corrupt → treated as "no saved grid"
  }
}

// Atomic (temp + rename) so a crash mid-write can't leave a truncated grid behind.
async function writeGridState(state: unknown): Promise<boolean> {
  try {
    await writeFileAtomic(GRID_STATE_FILE, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// The channel a grid-state change is broadcast on, so every open browser applies it live and
// the grids stay identical instead of drifting after the initial load.
export const GRID_STATE_CHANNEL = "grid-state";

interface GridStateRouteOptions {
  // Writing the grid is a privileged local action (same guard as the other POST routes) so
  // a random site the user visits can't quietly rearrange their grid. GET is read-only and
  // no more sensitive than /api/sessions, so it stays open.
  isAllowedOrigin: (origin?: string, host?: string) => boolean;
  // Broadcast the saved grid so other browsers apply it live (see GRID_STATE_CHANNEL).
  publish: (channel: string, data: unknown) => void;
}

export function mountGridStateRoutes(app: Express, { isAllowedOrigin, publish }: GridStateRouteOptions): void {
  app.get("/api/grid-state", (_req, res) => {
    res.json({ state: readGridState() });
  });

  app.post("/api/grid-state", async (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) return res.status(403).json({ error: "forbidden origin" });
    const body = isRecord(req.body) ? req.body.state : undefined;
    if (!looksLikeGridState(body)) return res.status(400).json({ error: "state must be a grid object with a cells array" });
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return res.status(413).json({ error: "grid state too large" });
    if (!(await writeGridState(body))) return res.status(500).json({ error: "failed to persist grid state" });
    publish(GRID_STATE_CHANNEL, body);
    res.json({ ok: true });
  });
}
