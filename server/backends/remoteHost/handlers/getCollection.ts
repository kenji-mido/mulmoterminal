// getCollection command handler.
//
// One collection's detail + a PAGE of its records (pagination mandatory — the result
// rides inside a 1 MiB Firestore command doc).
import { listItems, loadCollection, toDetail } from "@mulmoclaude/core/collection/server";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset, deriveItems, pageResult } from "../collectionPage.js";

export const getCollection: CommandHandlers["getCollection"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const offset = clampOffset(params.offset);
  const limit = clampLimit(params.limit);
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const all = deriveItems(collection.schema, await listItems(collection.dataDir));
  return pageResult(toDetail(collection), all, offset, limit);
};
