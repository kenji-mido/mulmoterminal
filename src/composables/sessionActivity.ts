import { isRecord } from "../../common/isRecord";
// Pure parse of a "sessions" pub/sub payload into an attention-state update, so the
// grid can track a cell's blocked/done even while the cell is OFF-PAGE (unmounted).
// The payload carries dev-terminal (grid) activity that the /api/sessions list drops,
// and isn't capped by the list limit. Kept pure + separate for unit testing.

export interface CellActivity {
  working: boolean;
  waiting: boolean;
  event: string | null;
}

/** One session's attention state, read off an untrusted body. The seed endpoint answers a MAP of
 *  id -> this, with no `id` inside each value, so parseSessionActivityPayload (which keys on `id`)
 *  is the wrong reader for it. */
export function readCellActivity(value: unknown): CellActivity | null {
  if (!isRecord(value)) return null;
  return { working: !!value.working, waiting: !!value.waiting, event: typeof value.event === "string" ? value.event : null };
}

export type SessionActivityUpdate = { id: string; closed: true } | { id: string; activity: CellActivity };

export function parseSessionActivityPayload(data: unknown): SessionActivityUpdate | null {
  if (!isRecord(data)) return null;
  const d = data;
  if (typeof d.id !== "string") return null;
  // A "closed" push means the session's PTY was reaped — drop it (no attention).
  if (d.event === "closed") return { id: d.id, closed: true };
  return {
    id: d.id,
    activity: {
      working: !!d.working,
      waiting: !!d.waiting,
      event: typeof d.event === "string" ? d.event : null,
    },
  };
}
