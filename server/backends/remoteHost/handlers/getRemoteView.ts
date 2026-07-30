// getRemoteView command handler.
//
// One mobile custom view, wrapped host-side into its sandboxed srcdoc (CSP +
// postMessage bootstrap) — the phone renders the artifact verbatim.
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { buildRemoteView, remoteViewFailureMessage } from "../../remoteView.js";

export const getRemoteView: CommandHandlers["getRemoteView"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const locale = typeof params.locale === "string" ? params.locale : "";
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await buildRemoteView(collection, viewId, locale);
  if (result.kind !== "ok") throw new Error(remoteViewFailureMessage(result, slug));
  return toJsonObject({ view: result.view, srcdoc: result.srcdoc, bytes: result.bytes });
};
