// The rules behind the two list endpoints, separated from the routes that serve them so
// they can be tested without an app: which sessions the sidebar shows, in what order, and
// which ids an activity poll is allowed to ask about.
//
// Worth isolating because the rules are quiet — a row that should have been hidden still
// looks like a plausible response, so a regression here reads as correct output.
import type { DiskStat, PendingSession } from "./types.js";

export type SessionRow = DiskStat | PendingSession;

export interface SessionRowFilter {
  /** Transient internal helpers, never user-visible chats: translation workers, and the
   *  rate-limit probe's own sessions (#1010). */
  isInternalHelper: (id: string) => boolean;
  /** Multi-terminal GRID sessions. */
  isDevTerminal: (id: string) => boolean;
  /** Background workers (scheduled collection refresh, hidden spawnBackgroundChat). Listed,
   *  but the client shows them under their own filter rather than among the chats. */
  isBackground: (id: string) => boolean;
  /** True for the unscoped (chat sidebar) query, false for a cwd-scoped one. */
  includePending: boolean;
  limit: number;
  /** Cap for background rows, counted separately from `limit`. */
  backgroundLimit: number;
}

/** The rows a listing should render: newest first, capped, with the hidden kinds dropped.
 *  The dev-terminal exclusion applies ONLY to the unscoped chat query — the grid's own
 *  resume picker passes ?cwd= and must keep listing its sessions, or they stop being
 *  resumable. Pure so that rule can be pinned; it is one boolean away from silently
 *  hiding the grid's own sessions from itself.
 *
 *  Background rows get their OWN cap rather than competing for `limit`. The client hides
 *  them by default, so under one shared cap a busy collection schedule would push real
 *  chats off the end — and all the user would see is a list that quietly got shorter. */
export function selectSessionRows(rows: readonly SessionRow[], filter: SessionRowFilter): SessionRow[] {
  const visible = rows
    .filter((row) => !filter.isInternalHelper(row.id))
    .filter((row) => !filter.includePending || !filter.isDevTerminal(row.id))
    .sort((a, b) => b.mtime - a.mtime);
  const chats = visible.filter((row) => !filter.isBackground(row.id)).slice(0, filter.limit);
  const background = visible.filter((row) => filter.isBackground(row.id)).slice(0, filter.backgroundLimit);
  return [...chats, ...background].sort((a, b) => b.mtime - a.mtime);
}

/** The session ids an /api/activity poll may ask about: well-formed ones only, capped so a
 *  client can't make us parse an unbounded query string. A non-string query yields none. */
export function parseActivityIds(raw: unknown, isValidId: (id: string) => boolean, limit: number): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .filter((id) => isValidId(id))
    .slice(0, limit);
}
