// getFeed command handler.
//
// One feed's detail + a PAGE of its records. A feed IS a LoadedCollection with an `ingest` block,
// located via the feed registry (feeds live under their own registry, not the collections dir), so
// this reuses the exact collection page path and returns the SAME shape as getCollection — the
// phone renders feed records with the same card view.
import { listItems, toDetail } from "@mulmoclaude/core/collection/server";
import { listFeeds } from "@mulmoclaude/core/feeds/server";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";
import { clampLimit, clampOffset, deriveItems, pageResult } from "../collectionPage.js";

export const createGetFeed =
  (workspace: string): CommandHandlers["getFeed"] =>
  async (params: JsonObject) => {
    const slug = String(params.slug ?? "");
    const offset = clampOffset(params.offset);
    const limit = clampLimit(params.limit);
    const feed = (await listFeeds(workspace)).find((entry) => entry.slug === slug);
    if (!feed) throw new Error(`feed '${slug}' not found`);
    const all = deriveItems(feed.schema, await listItems(feed.dataDir));
    return pageResult(toDetail(feed), all, offset, limit);
  };
