// mutateRemoteViewItem command handler.
//
// Apply one update/delete requested by a writable mobile view, authorized by that view's
// declared surface (editableFields / allowDelete) and enforced HOST-side — the sandboxed
// view is never trusted.
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { normalizeMutate } from "@mulmoclaude/core/remote-view";
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { mutateRemoteView, mutateRemoteViewFailureMessage } from "../../remoteView.js";
import { mutateWriteApplied } from "../../mutateStatus.js";

export const mutateRemoteViewItem: CommandHandlers["mutateRemoteViewItem"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const request = normalizeMutate({ op: params.op, id: params.id, patch: params.patch });
  if (!request) throw new Error("invalid mutate request — expected { op: 'update'|'delete', id, patch? }");
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await mutateRemoteView(collection, viewId, request);
  // The write applied but its response blew the byte budget — report success (+refetch),
  // not a thrown error the phone shows as a failed edit while keeping stale data (#747).
  if (mutateWriteApplied(result)) {
    return toJsonObject({ op: request.op, id: request.id, applied: true, warning: mutateRemoteViewFailureMessage(result, slug) });
  }
  if (result.kind !== "ok") throw new Error(mutateRemoteViewFailureMessage(result, slug));
  // Same reason as getRemoteViewItems: `CollectionItem`'s `unknown`-valued index signature is not
  // provably JSON, though the loader only ever writes JSON into it.
  return (result.op === "delete" ? { op: "delete", id: result.id } : { op: "update", item: result.item }) as JsonObject;
};
