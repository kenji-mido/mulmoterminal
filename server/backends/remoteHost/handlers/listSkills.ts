// listSkills command handler.
//
// Discoverable skill ids (~/.claude/skills + <workspace>/.claude/skills), read-only. Collection
// slugs are subtracted — a skill dir that ships a schema.json is a collection served by
// listCollections, so it must not double-list here (mirrors MulmoClaude's listSkills).
//
// The subtraction is what `discoverCollections` answers FOR THIS ROOT, and since core 3.3.0 that
// is scope-isolated: outside the managed workspace it excludes `~/.claude/skills` (see
// backends/collections.ts). So a user-scope collection stays in this list when a project is
// named — correctly, because the reason to subtract is that listCollections serves it, and for
// that root it does not. It is a skill there, runnable by `claude` like any other under `~`.
import { discoverCollections } from "@mulmoclaude/core/collection/server";
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { discoverSkillNames } from "../skills.js";
import { scopeFromCommand } from "../commandScope.js";

export const createListSkills =
  (workspace: string): CommandHandlers["listSkills"] =>
  async (params: JsonObject) => {
    // The injected workspace is the DEFAULT, not the only answer — see ../commandScope.ts.
    const scope = scopeFromCommand(params, workspace);
    const [names, collections] = await Promise.all([discoverSkillNames(scope), discoverCollections(scope)]);
    const collectionSlugs = new Set(collections.filter((collection) => collection.source !== "feed").map((collection) => collection.slug));
    return toJsonObject({ skills: names.filter((name) => !collectionSlugs.has(name)) });
  };
