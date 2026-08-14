// Map active bell notifications back to the collection records they point at, so
// the plugin's Kanban view can accent a card that has a pending completion bell.
// MulmoTerminal's port of MulmoClaude's src/utils/collections/notifiedItems.ts —
// it lives in that app's source rather than in @mulmoclaude/core, so the logic is
// mirrored here and pinned by a spec against what our own publisher writes.
//
// The entries come from the live bell (`useNotifications().active`), which is fed
// by both apps' publishers over the shared notifier file — so a bell MulmoClaude
// published accents the same card here. Reading is all this does: the one-bell-per
// -record invariant is enforced server-side on `legacyId`, and nothing on this path
// can publish, clear, or duplicate an entry.
import { collectionNotifyTargetOf } from "../../common/collectionNotifyTarget";

/** Bell severities, worst last — mirrors the notifier's own `severity`. The Kanban
 *  accent colours by this so a card matches the bell badge (urgent red, nudge amber). */
export type NotifiedSeverity = "info" | "nudge" | "urgent";

const SEVERITY_RANK: Record<NotifiedSeverity, number> = { info: 0, nudge: 1, urgent: 2 };

function asSeverity(value: unknown): NotifiedSeverity {
  return value === "urgent" || value === "nudge" ? value : "info";
}

/** The minimum entry shape this module reads — a structural subset of the bell's
 *  `NotifierEntry`, so callers pass `useNotifications().active` straight in. */
export interface NotifiedEntryLike {
  pluginData?: unknown | undefined;
  severity?: string | undefined;
}

/** itemId → worst active severity, for records of `slug` IN `projectId`. Entries without a
 *  concrete `itemId` are skipped (a collection-level bell can't point at one card), and when a
 *  record has several bells the highest severity wins so the accent matches the most urgent one.
 *
 *  `projectId` is the project the view being accented is showing — `null`/omitted for the
 *  workspace, which is also what a bell with no project on its target means. It is matched
 *  rather than ignored because a slug is unique within a root only: two projects' `tasks` are
 *  different collections, and with a `primaryKey` schema their record ids are not even unlikely
 *  to coincide — they are drawn from the data (an ISBN, an email address), so a shared record
 *  in two projects has the SAME id, and ignoring the project accents the wrong card reliably
 *  rather than rarely. */
export function collectionNotifiedSeverities(entries: readonly NotifiedEntryLike[], slug: string, projectId?: string | null): Map<string, NotifiedSeverity> {
  const out = new Map<string, NotifiedSeverity>();
  const project = projectId ?? null;
  for (const entry of entries) {
    const target = collectionNotifyTargetOf(entry.pluginData);
    if (!target || target.slug !== slug || !target.itemId) continue;
    if ((target.project ?? null) !== project) continue;
    const severity = asSeverity(entry.severity);
    const existing = out.get(target.itemId);
    if (!existing || SEVERITY_RANK[severity] > SEVERITY_RANK[existing]) out.set(target.itemId, severity);
  }
  return out;
}
