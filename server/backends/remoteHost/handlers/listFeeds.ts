// listFeeds command handler.
//
// Feed registry with retrieval kind / schedule / last-fetch time (read-only).
import { listFeeds, readFeedState } from "@mulmoclaude/core/feeds/server";
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { feedSummary } from "../../feed-summary.js";
import { scopeFromCommand } from "../commandScope.js";

export const createListFeeds =
  (workspace: string): CommandHandlers["listFeeds"] =>
  async (params: JsonObject) => {
    // The injected workspace is the DEFAULT, not the only answer — see ../commandScope.ts.
    const { workspaceRoot: root } = scopeFromCommand(params, workspace);
    const feeds = await listFeeds(root);
    const summaries = [];
    for (const feed of feeds) {
      const state = await readFeedState(root, feed);
      summaries.push(feedSummary(feed, state.lastFetchedAt));
    }
    return toJsonObject({ feeds: summaries });
  };
