// The pure wrap/unwrap helpers behind MulmoTerminal's collection-completion bells.
// CROSS-APP PARITY: these MUST stay byte-identical to MulmoClaude's
// (server/workspace/collections/notifications.ts) so a bell either app published
// carries the same shape and the same `legacyId` — otherwise a record recognised by
// only one app's `readEntry` gets a second bell. The legacy types live in
// MulmoClaude's app source (not the published package), so the shape is mirrored
// here rather than imported.
import type { CompletionPriority } from "@mulmoclaude/core/collection-watchers";
import type { NotifierSeverity } from "@mulmoclaude/core/notifier";
import { isRecord } from "../../common/isRecord.js";
// The view marker the UI narrows on when it accents a notified record — shared so
// the writer here and the reader there cannot drift apart.
import { COLLECTION_NOTIFY_VIEW } from "../../common/collectionNotifyTarget.js";

// `legacy: true` + a string `legacyId` + a string `kind` is the marker both apps'
// readEntry recognise; the navigate `action` preserves the bell's icon/routing.
export interface LegacyNotifierPluginData {
  legacy: true;
  legacyId: string;
  kind: "todo";
  priority: "normal" | "high";
  action: { type: "navigate"; target: { view: "collections"; slug: string; itemId: string; project?: string } };
}

export function isLegacyNotifierPluginData(value: unknown): value is LegacyNotifierPluginData {
  if (!isRecord(value)) return false;
  const rec = value;
  return rec.legacy === true && typeof rec.legacyId === "string" && typeof rec.kind === "string";
}

/** Deep-link the bell row navigates to: `/collections/<slug>?selected=<itemId>` (the
 *  documented record permalink). Dot-segment slugs would normalise out of the route,
 *  so fall back to the index — matches MulmoClaude's builder.
 *
 *  `project` is the record's project as an OPAQUE ID — never a path: this string is written to
 *  a file two apps read and rendered into a URL in a browser. A slug is unique WITHIN a root and
 *  nowhere else, so without it a bell from a project's `tasks` opens the workspace's `tasks`:
 *  the same row, the same title, the wrong records, and nothing anywhere saying so.
 *
 *  RESOLVED BY THE CALLER (collectionWatchers.ts), which is handed the ROOT by the engine. This
 *  file stays free of server infra deliberately — a `test/src` spec imports it to build a
 *  fixture, and pulling `node:crypto` in through here puts Node's globals into a DOM-typed
 *  project, where `window.setTimeout` stops returning a number.
 *
 *  CROSS-APP PARITY IS PRESERVED where it is observable: the caller passes nothing for the
 *  WORKSPACE, so the workspace link — the only one MulmoClaude can produce or receive — is
 *  byte-for-byte what it was. Built by concatenation rather than URLSearchParams for the same
 *  reason: the latter encodes a space as `+` where MulmoClaude's builder writes `%20`. */
export function buildNavigateTarget(slug: string, itemId: string, project?: string): string {
  if (slug === "." || slug === "..") return "/collections";
  const base = `/collections/${encodeURIComponent(slug)}`;
  const query: string[] = [];
  // `selected` FIRST: it is what the pre-project link carried, so the common case is unchanged.
  if (itemId) query.push(`selected=${encodeURIComponent(itemId)}`);
  if (project) query.push(`project=${encodeURIComponent(project)}`);
  return query.length > 0 ? `${base}?${query.join("&")}` : base;
}

// high → urgent (red), normal → nudge (amber). Never "info" — the engine forbids
// info-severity action entries.
export function priorityToSeverity(priority: CompletionPriority): NotifierSeverity {
  return priority === "high" ? "urgent" : "nudge";
}

export function buildPluginData(input: {
  legacyId: string;
  slug: string;
  itemId: string;
  priority: CompletionPriority;
  /** The record's project, as the same opaque id `buildNavigateTarget` takes. Absent for the
   *  workspace. It rides on the target as well as in the URL because the UI narrows this shape
   *  to decide which record card to accent (common/collectionNotifyTarget.ts), and a slug-only
   *  target accents the same-named record of whichever project is on screen. */
  project?: string | undefined;
}): LegacyNotifierPluginData {
  const { legacyId, slug, itemId, priority, project } = input;
  return {
    legacy: true,
    legacyId,
    kind: "todo",
    priority: priority === "high" ? "high" : "normal",
    // The key is OMITTED rather than set to undefined for a workspace bell: this object is
    // serialised into a file MulmoClaude also reads, and an absent key is what it wrote.
    action: { type: "navigate", target: { view: COLLECTION_NOTIFY_VIEW, slug, itemId, ...(project ? { project } : {}) } },
  };
}

export function readEntry(pluginData: unknown): { legacyId: string; priority: CompletionPriority } | null {
  if (!isLegacyNotifierPluginData(pluginData)) return null;
  const priority: CompletionPriority = pluginData.priority === "high" ? "high" : "normal";
  return { legacyId: pluginData.legacyId, priority };
}
