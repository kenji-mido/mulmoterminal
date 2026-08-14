// getCollection command handler.
//
// One collection's detail + a PAGE of its records (pagination mandatory — the result
// rides inside a 1 MiB Firestore command doc).
//
// Records come from the STORE seam, never a raw `listItems(dataDir)`: a collection
// backed by a `dataSource` CSV or SQLite keeps no `.json` records on disk, so the
// dataDir read returned an empty page to the phone while the desktop UI (which has
// always gone through `storeFor`) showed the rows (#1488).
//
// Factory (createGetCollection) keeps the mapping unit-testable with the engine
// stubbed; the default export wires the real engine functions. Mirrors
// MulmoClaude's server/remoteHost/handlers/getCollection.ts.
import { loadCollection, storeFor, toDetail, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import { scopeFromCommand } from "../commandScope.js";
import type { ProjectScope } from "../../../infra/project-root.js";
import type { CollectionItem } from "@mulmoclaude/core/collection";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset, deriveItems, pageResult } from "../collectionPage.js";
import { readString } from "../../../../common/readString.js";

export interface GetCollectionDeps {
  loadCollection: typeof loadCollection;
  /** Store-aware records loader (file records or a dataSource CSV's rows). */
  listRecords: (collection: LoadedCollection, scope: ProjectScope) => Promise<CollectionItem[]>;
  toDetail: typeof toDetail;
}

export const createGetCollection =
  (deps: GetCollectionDeps): CommandHandlers["getCollection"] =>
  async (params: JsonObject) => {
    const slug = readString(params.slug);
    const offset = clampOffset(params.offset);
    const limit = clampLimit(params.limit);
    // Resolved PER CALL and threaded into both engine calls, rather than baked into the deps at
    // construction: the deps are built once, so a scope captured there is the one thing a later
    // `project` param could not change (../commandScope.ts).
    const scope = scopeFromCommand(params);
    const collection = await deps.loadCollection(slug, scope);
    if (!collection) throw new Error(`collection '${slug}' not found`);
    const all = deriveItems(collection.schema, await deps.listRecords(collection, scope));
    return pageResult(deps.toDetail(collection), all, offset, limit);
  };

export const getCollection = createGetCollection({
  loadCollection,
  listRecords: (collection, scope) => storeFor(collection, scope).list(),
  toDetail,
});
