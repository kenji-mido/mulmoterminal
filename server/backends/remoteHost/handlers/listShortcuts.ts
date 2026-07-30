// listShortcuts command handler.
//
// Pinned launcher shortcuts (favorites), read-only.
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";
import { readShortcuts } from "../../shortcuts.js";

export const createListShortcuts =
  (workspace: string): CommandHandlers["listShortcuts"] =>
  async () =>
    toJsonObject({ shortcuts: await readShortcuts(workspace) });
