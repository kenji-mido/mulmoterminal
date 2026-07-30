// listCollections command handler.
//
// Mirrors GET /api/collections/list → { collections: CollectionSummary[] }. Feeds
// (source "feed") are excluded — they are served by listFeeds.
import { discoverCollections, toSummary } from "@mulmoclaude/core/collection/server";
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";

export const listCollections: CommandHandlers["listCollections"] = async () => {
  const collections = (await discoverCollections()).filter((collection) => collection.source !== "feed").map(toSummary);
  return toJsonObject({ collections });
};
