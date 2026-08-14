// Dispatch a scheduled task's chat and record the run — the counterpart of MulmoClaude's
// `server/workspace/skills/scheduled-run.ts`, so both hosts write the same state and history for
// a task registered directly on the task-manager (user tasks get no catch-up in either host;
// what they get is a record of every run).
//
// The verdict is the turn's REAL outcome, not "the spawn returned": a scheduled chat can still
// fail its first turn, and recording at dispatch would file that as a successful 8 ms run.
import { recordExternalRun, TASK_TRIGGERS, type TaskSchedule, type TaskTrigger } from "@mulmoclaude/core/scheduler";
import { messageOf } from "../errors.js";

/** Spawn a scheduled chat, returning its session id. `onComplete` fires once, when the session's
 *  turn finishes or its teardown reports failure. Throws when the spawn itself fails. */
export type ScheduledChatSpawn = (message: string, onComplete?: (outcome: { didError: boolean }, chatSessionId: string) => void | Promise<void>) => string;

export interface ScheduledTaskMeta {
  /** Task-manager id (`user.<id>`, `system.worklog`) — the key its state and log entries are
   *  filed under. */
  id: string;
  name: string;
  schedule: TaskSchedule;
}

export interface ScheduledDispatch extends ScheduledTaskMeta {
  message: string;
  trigger: TaskTrigger;
  spawnChat: ScheduledChatSpawn;
}

const didNotComplete = (name: string): string => `${name} run did not complete successfully`;

/** Dispatch a USER task's chat, recording either the dispatch failure or the turn's outcome.
 *  Rethrows a dispatch failure so the task-manager tick logs it too. */
export async function fireScheduledChat(dispatch: ScheduledDispatch): Promise<string> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  try {
    // No register-before-dispatch dance is needed here (MulmoClaude's `startChat` is async and can
    // finish before it returns): this spawn is synchronous and registers the hook itself.
    return dispatch.spawnChat(dispatch.message, (outcome, chatSessionId) =>
      recordRun(dispatch, dispatch.trigger, startedAt, startMs, outcome.didError ? didNotComplete(dispatch.name) : null, chatSessionId),
    );
  } catch (err) {
    await recordRun(dispatch, dispatch.trigger, startedAt, startMs, messageOf(err), undefined);
    throw err;
  }
}

/** Spawn a SYSTEM task's chat, filing a failure against the task when its turn finally ends.
 *
 *  Such a task's `run` must NOT await that outcome, and this is the reason: the tick loop drops
 *  every tick that overlaps a still-running one, so a batch that takes minutes would silence the
 *  whole scheduler — feed refresh and calendar sync included — for its duration. So `run` returns
 *  at the spawn, the persistence adapter files that as the run, and a turn that then dies is
 *  filed here rather than left reading "success". The cost is one extra `totalRuns` on a failed
 *  run, which is the cheaper of the two wrong numbers. */
export function spawnSystemChat(task: ScheduledTaskMeta, message: string, spawnChat: ScheduledChatSpawn): void {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  // Reported as `scheduled` even for a catch-up run: `SystemTaskDef.run` takes no context, so
  // which trigger fired it is not knowable here.
  spawnChat(message, (outcome, chatSessionId) =>
    outcome.didError ? recordRun(task, TASK_TRIGGERS.scheduled, startedAt, startMs, didNotComplete(task.name), chatSessionId) : undefined,
  );
}

/** Persist one run's state + history entry. `runError` null = success. */
async function recordRun(
  task: ScheduledTaskMeta,
  trigger: TaskTrigger,
  startedAt: string,
  startMs: number,
  runError: string | null,
  chatSessionId: string | undefined,
): Promise<void> {
  await recordExternalRun({
    id: task.id,
    name: task.name,
    schedule: task.schedule,
    scheduledFor: startedAt,
    startedAt,
    durationMs: Date.now() - startMs,
    trigger,
    errorMessage: runError,
    chatSessionId,
  });
}
