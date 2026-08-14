// getRemoteViewItems command handler.
//
// One page of a mobile view's records, projected to the view's fields. Image fields are
// NOT inlined on this host yet (no thumbnail store) — they come back as workspace paths
// (unrenderable on the phone) and count as `omitted`.
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { normalizeFields } from "@mulmoclaude/core/remote-view";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset } from "../collectionPage.js";
import { remoteViewItemsFor, remoteViewItemsFailureMessage } from "../../remoteView.js";
import { scopeFromCommand } from "../commandScope.js";
import { jsonPayload } from "../jsonPayload.js";
import { readString } from "../../../../common/readString.js";

export const getRemoteViewItems: CommandHandlers["getRemoteViewItems"] = async (params: JsonObject) => {
  const slug = readString(params.slug);
  const viewId = readString(params.viewId);
  const fields = normalizeFields(params.fields);
  const request = { offset: clampOffset(params.offset), limit: clampLimit(params.limit), ...(fields ? { fields } : {}) };
  // The project this command names, or the host's workspace when it names none (../commandScope.ts).
  const scope = scopeFromCommand(params);
  const collection = await loadCollection(slug, scope);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await remoteViewItemsFor(scope)(collection, viewId, request);
  if (result.kind !== "ok") throw new Error(remoteViewItemsFailureMessage(result, slug));
  // Converted rather than asserted (see ../jsonPayload.ts): `RemoteViewPage` has no index
  // signature at all, so it does not even overlap `JsonObject` — which is why this used to need a
  // DOUBLE cast. It is JSON at runtime because the collection loader only ever puts JSON in it.
  return jsonPayload({ page: result.page, inlined: result.inlined, omitted: result.omitted });
};
