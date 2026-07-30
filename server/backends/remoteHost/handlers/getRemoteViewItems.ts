// getRemoteViewItems command handler.
//
// One page of a mobile view's records, projected to the view's fields. Image fields are
// NOT inlined on this host yet (no thumbnail store) — they come back as workspace paths
// (unrenderable on the phone) and count as `omitted`.
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { normalizeFields } from "@mulmoclaude/core/remote-view";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset } from "../collectionPage.js";
import { remoteViewItems, remoteViewItemsFailureMessage } from "../../remoteView.js";

export const getRemoteViewItems: CommandHandlers["getRemoteViewItems"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const fields = normalizeFields(params.fields);
  const request = { offset: clampOffset(params.offset), limit: clampLimit(params.limit), ...(fields ? { fields } : {}) };
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await remoteViewItems(collection, viewId, request);
  if (result.kind !== "ok") throw new Error(remoteViewItemsFailureMessage(result, slug));
  // `toJsonObject` cannot serve this one, and neither can a single assertion: `RemoteViewPage` has
  // no index signature at all, so it does not even overlap `JsonObject`. It IS JSON at runtime —
  // the collection loader only ever puts JSON in it — a fact about the loader these types do not
  // record. Removing this double cast means giving `RemoteViewPage`/`RemoteViewItem` JSON-valued
  // types upstream, not adjusting anything here.
  return { page: result.page, inlined: result.inlined, omitted: result.omitted } as unknown as JsonObject;
};
