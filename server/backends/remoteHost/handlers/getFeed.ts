// getFeed command handler.
//
// One feed's detail + a PAGE of its records. A feed IS a LoadedCollection with an `ingest` block,
// located via the feed registry (feeds live under their own registry, not the collections dir), so
// this reuses the exact collection page path (storeFor + toDetail + collectionPage) and returns the
// SAME shape as getCollection — the phone renders feed records with the same card view. That
// includes reading through the STORE seam rather than a raw dataDir `listItems`; see
// getCollection.ts for why (#1488).
//
// Two factories, unlike MulmoClaude's single one: this host's workspace root is wired at runtime
// from server/index.ts rather than being a module constant, so `getFeedFor` is the real wiring and
// `createGetFeed` the fully-stubbable seam.
import { storeFor, toDetail, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import type { CollectionItem } from "@mulmoclaude/core/collection";
import { listFeeds } from "@mulmoclaude/core/feeds/server";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset, deriveItems, pageResult } from "../collectionPage.js";
import { readString } from "../../../../common/readString.js";
import { scopeFromCommand } from "../commandScope.js";
import type { ProjectScope } from "../../../infra/project-root.js";

export interface GetFeedDeps {
  listFeeds: typeof listFeeds;
  /** Store-aware records loader (file records or a dataSource CSV's rows). */
  listRecords: (collection: LoadedCollection, scope: ProjectScope) => Promise<CollectionItem[]>;
  toDetail: typeof toDetail;
  /** The host's own root — the DEFAULT a command that names no project resolves to. */
  workspaceRoot: string;
}

export const createGetFeed =
  (deps: GetFeedDeps): CommandHandlers["getFeed"] =>
  async (params: JsonObject) => {
    const slug = readString(params.slug);
    const offset = clampOffset(params.offset);
    const limit = clampLimit(params.limit);
    // Resolved per call, defaulting to the injected root (../commandScope.ts).
    const scope = scopeFromCommand(params, deps.workspaceRoot);
    const feed = (await deps.listFeeds(scope.workspaceRoot)).find((entry) => entry.slug === slug);
    if (!feed) throw new Error(`feed '${slug}' not found`);
    const all = deriveItems(feed.schema, await deps.listRecords(feed, scope));
    return pageResult(deps.toDetail(feed), all, offset, limit);
  };

export const getFeedFor = (workspaceRoot: string): CommandHandlers["getFeed"] =>
  createGetFeed({ listFeeds, listRecords: (collection, scope) => storeFor(collection, scope).list(), toDetail, workspaceRoot });
