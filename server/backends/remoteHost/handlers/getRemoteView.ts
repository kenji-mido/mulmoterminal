// getRemoteView command handler.
//
// One mobile custom view, wrapped host-side into its sandboxed srcdoc (CSP +
// postMessage bootstrap) — the phone renders the artifact verbatim.
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { buildRemoteViewFor, remoteViewFailureMessage } from "../../remoteView.js";
import { scopeFromCommand } from "../commandScope.js";
import { readString } from "../../../../common/readString.js";

export const getRemoteView: CommandHandlers["getRemoteView"] = async (params: JsonObject) => {
  const slug = readString(params.slug);
  const viewId = readString(params.viewId);
  const locale = typeof params.locale === "string" ? params.locale : "";
  // The project this command names, or the host's workspace when it names none (../commandScope.ts).
  const scope = scopeFromCommand(params);
  const collection = await loadCollection(slug, scope);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await buildRemoteViewFor(scope)(collection, viewId, locale);
  if (result.kind !== "ok") throw new Error(remoteViewFailureMessage(result, slug));
  return toJsonObject({ view: result.view, srcdoc: result.srcdoc, bytes: result.bytes });
};
