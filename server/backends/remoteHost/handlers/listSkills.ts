// listSkills command handler.
//
// Discoverable skill ids (~/.claude/skills + <workspace>/.claude/skills), read-only. Collection
// slugs are subtracted — a skill dir that ships a schema.json is a collection served by
// listCollections, so it must not double-list here (mirrors MulmoClaude's listSkills).
import { discoverCollections } from "@mulmoclaude/core/collection/server";
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";
import { discoverSkillNames } from "../skills.js";

export const createListSkills =
  (workspace: string): CommandHandlers["listSkills"] =>
  async () => {
    const [names, collections] = await Promise.all([discoverSkillNames({ workspaceRoot: workspace }), discoverCollections()]);
    const collectionSlugs = new Set(collections.filter((collection) => collection.source !== "feed").map((collection) => collection.slug));
    return toJsonObject({ skills: names.filter((name) => !collectionSlugs.has(name)) });
  };
