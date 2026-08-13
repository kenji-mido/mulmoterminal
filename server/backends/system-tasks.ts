import { feedRefreshTaskDef } from "@mulmoclaude/core/feeds/server";
import { googleCalendarSyncTaskDef } from "@mulmoclaude/core/google";
import type { TaskDefinition } from "@mulmoclaude/core/scheduler";
import { worklogSystemTask } from "./worklog.js";

export interface SystemTaskDeps {
  workspaceRoot: string;
  worklog: { enabled: boolean; intervalHours: number };
  spawnChat: (message: string) => void;
}

// The system tasks a standalone MulmoTerminal registers — the ones that must keep running with no
// MulmoClaude on the machine. Both shared ones come from a core factory so the id, schedule and run
// can't drift between the two hosts.
//
// Feed refresh and calendar sync are safe to run alongside MulmoClaude on the same workspace
// because each engine soft-dedups on a marker IN that workspace: feeds on `lastFetchedAt`, calendar
// on `lastSyncedAt` (core >= 1.12.0, receptron/mulmoclaude#2678). Whoever gets there first claims
// it and the other skips. That only holds while both hosts point at the SAME workspace root — the
// marker is workspace state, so two roots means no dedup.
//
// Calendar claims at START rather than on success: since `autoPush` the run writes to Google, and
// a first full walk takes minutes, which would otherwise sit open for the other host to enter.
//
// Extracted from index.ts so the list is a value a spec can read. It went months missing the
// calendar task with nothing to notice (#1191).
export function buildSystemTasks(deps: SystemTaskDeps): TaskDefinition[] {
  return [
    feedRefreshTaskDef({ workspaceRoot: deps.workspaceRoot }),
    googleCalendarSyncTaskDef({ workspaceRoot: deps.workspaceRoot }),
    worklogSystemTask({ ...deps.worklog, spawnChat: deps.spawnChat }),
  ].filter((task): task is TaskDefinition => task !== null);
}
