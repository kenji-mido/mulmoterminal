// The navigate target a collection-completion bell carries, and the one narrowing
// that reads it back. Shared because BOTH sides decide from it: the server writes
// the target when it publishes a bell (server/backends/collectionNotifierAdapter.ts)
// and the UI reads it to accent the record's card (src/utils/collectionNotified.ts).
// A second copy of the literal in the reader is exactly how a writer/reader pair
// drifts silently — the bell keeps arriving, only the accent stops appearing.
//
// CROSS-APP: the shape is MulmoClaude's, which spells the view constant
// `NOTIFICATION_VIEWS.collections` in its own app source. The VALUE is what
// crosses the workspace, so keeping it in one place here (rather than importing a
// constant that isn't published) changes nothing on the wire — entries from either
// app narrow identically.
import { isRecord } from "./isRecord.js";

/** `pluginData.action.target.view` for a bell pointing at a collection record. */
export const COLLECTION_NOTIFY_VIEW = "collections";

export interface CollectionNotifyTarget {
  slug: string;
  /** Absent on a collection-level bell — those can't accent a specific record. */
  itemId?: string | undefined;
  /** The record's project, as the opaque id the API takes. ABSENT MEANS THE WORKSPACE — both
   *  because that is what a workspace bell has always written and because it is the only thing
   *  MulmoClaude, which has one root, can write. A slug is unique within a root and nowhere
   *  else, so a reader that ignores this accents the same-named record of whichever project is
   *  on screen. */
  project?: string | undefined;
}

/** Narrow a notification's opaque `pluginData` to its collection navigate target,
 *  or null when it isn't one. `pluginData` reaches the browser as `unknown` (it is
 *  whatever the publishing app put there, and the other app's version of this
 *  repo may be older), so every level is checked rather than trusted. */
export function collectionNotifyTargetOf(pluginData: unknown): CollectionNotifyTarget | null {
  if (!isRecord(pluginData)) return null;
  const { action } = pluginData;
  if (!isRecord(action)) return null;
  const { target } = action;
  if (!isRecord(target)) return null;
  const { view, slug, itemId, project } = target;
  if (view !== COLLECTION_NOTIFY_VIEW || typeof slug !== "string" || slug.length === 0) return null;
  return {
    slug,
    itemId: typeof itemId === "string" && itemId.length > 0 ? itemId : undefined,
    project: typeof project === "string" && project.length > 0 ? project : undefined,
  };
}
