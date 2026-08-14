// A system task with NO state entry gets no catch-up: `computeCatchUpPlan` reads a missing
// entry as "just registered" and enumerates nothing — and because nothing is then written,
// the next boot reads it as just-registered again. That loop is #1581 surviving its own fix:
// a 6-hour task on a laptop that is never up at a UTC window would still never run once.
//
// Seeding `lastRunAt` with the boot time starts the window accounting, so the boot AFTER a
// missed window catches it up. `totalRuns` stays 0 — nothing here claims a run happened.
//
// Seeding must land BEFORE `initScheduler`: the adapter loads this file into memory once and
// rewrites the whole map on every save, so a later external write is clobbered by the next run.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SCHEDULE_TYPES,
  emptyState,
  loadState,
  nextWindowAfter,
  saveState,
  type StateDeps,
  type StateMap,
  type TaskSchedule as CoreSchedule,
} from "@receptron/task-scheduler";
import type { TaskSchedule } from "@mulmoclaude/core/scheduler";
import { writeFileAtomic } from "../files/atomic-write.js";

const MS_PER_SECOND = 1000;

export interface SeedTask {
  id: string;
  schedule: TaskSchedule;
}

/** Mirrors the adapter's own location (`SCHEDULER_CONFIG_DIR` + `state.json`), which the
 *  package does not export. Both hosts read the same file for the same workspace. */
export function schedulerStateFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "config", "scheduler", "state.json");
}

/** The host-schedule shape the task-manager takes, in the window library's terms. */
function toCoreSchedule(schedule: TaskSchedule): CoreSchedule {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    return { type: SCHEDULE_TYPES.interval, intervalSec: Math.round(schedule.intervalMs / MS_PER_SECOND) };
  }
  return schedule;
}

/** When this schedule next fires, for the API to show before the first run ever happens. */
function nextWindowIso(schedule: TaskSchedule, now: Date): string | null {
  const next = nextWindowAfter(toCoreSchedule(schedule), now.getTime() + 1);
  return next === null ? null : new Date(next).toISOString();
}

/** Give every task without a starting point one. Returns the ids seeded — pure apart from the
 *  map it fills, so the boot behaviour is testable without a filesystem.
 *
 *  Keyed on `lastRunAt`, not on the entry existing: an entry that somehow has none is stuck in
 *  the same never-caught-up loop, and the rest of its fields (run counts, last error) are still
 *  worth keeping. */
export function seedStates(states: StateMap, tasks: readonly SeedTask[], now: Date): string[] {
  const seeded: string[] = [];
  for (const task of tasks) {
    const current = states.get(task.id);
    if (current && current.lastRunAt !== null) continue;
    states.set(task.id, { ...(current ?? emptyState(task.id)), lastRunAt: now.toISOString(), nextScheduledAt: nextWindowIso(task.schedule, now) });
    seeded.push(task.id);
  }
  return seeded;
}

function stateDeps(): StateDeps {
  return {
    readFile: (filePath: string) => readFile(filePath, "utf-8"),
    writeFileAtomic: (filePath: string, content: string) => writeFileAtomic(filePath, content),
    exists: existsSync,
  };
}

/** Read the state file, seed the tasks missing from it, write it back. Returns the ids
 *  seeded (empty when every task already had one — the steady state after the first boot). */
export async function seedSchedulerState(workspaceRoot: string, tasks: readonly SeedTask[], now: Date): Promise<string[]> {
  const filePath = schedulerStateFilePath(workspaceRoot);
  const states = await loadState(filePath, stateDeps());
  const seeded = seedStates(states, tasks, now);
  if (seeded.length > 0) await saveState(filePath, states, stateDeps());
  return seeded;
}
