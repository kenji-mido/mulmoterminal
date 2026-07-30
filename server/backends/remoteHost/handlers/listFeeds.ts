// listFeeds command handler.
//
// Feed registry with retrieval kind / schedule / last-fetch time (read-only).
import { listFeeds, readFeedState } from "@mulmoclaude/core/feeds/server";
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";
import { feedSummary } from "../../feed-summary.js";

export const createListFeeds =
  (workspace: string): CommandHandlers["listFeeds"] =>
  async () => {
    const feeds = await listFeeds(workspace);
    const summaries = [];
    for (const feed of feeds) {
      const state = await readFeedState(workspace, feed);
      summaries.push(feedSummary(feed, state.lastFetchedAt));
    }
    return toJsonObject({ feeds: summaries });
  };
