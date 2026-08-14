// @vitest-environment node
// #1581. The catch-up engine reads a task with no state entry as "just registered" and
// enumerates no missed windows — and nothing is written, so the next boot reads it the same
// way. A 6-hour task on a machine that is never up at a UTC window therefore never ran once,
// with no state file, no log and no error. The seed is what breaks that loop.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeCatchUpPlan, MISSED_RUN_POLICIES, SCHEDULE_TYPES, type StateMap } from "@receptron/task-scheduler";
import { schedulerStateFilePath, seedSchedulerState, seedStates } from "../../../server/backends/scheduler-state-seed.js";

const HOUR_MS = 3_600_000;
const BOOT = new Date("2026-08-10T04:30:00.000Z");
const SEVEN_HOURS_LATER = new Date(BOOT.getTime() + 7 * HOUR_MS);
const WORKLOG = { id: "system.worklog", schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 6 * HOUR_MS } } as const;

// The same task in the catch-up library's terms (seconds, plus the policy the adapter passes).
const catchUpTask = {
  id: WORKLOG.id,
  name: "Dev worklog",
  schedule: { type: SCHEDULE_TYPES.interval, intervalSec: 6 * 60 * 60 },
  missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
  enabled: true,
} as const;

const tempDirs: string[] = [];
const makeWorkspace = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-seed-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("seedStates", () => {
  it("starts the window accounting without claiming a run happened", () => {
    const states: StateMap = new Map();

    expect(seedStates(states, [WORKLOG], BOOT)).toEqual([WORKLOG.id]);

    const seeded = states.get(WORKLOG.id);
    expect(seeded?.lastRunAt).toBe(BOOT.toISOString());
    expect(seeded?.totalRuns).toBe(0);
    expect(seeded?.lastRunResult).toBeNull();
    // 04:30 UTC on a 6-hour cadence — the next epoch-aligned window is 06:00.
    expect(seeded?.nextScheduledAt).toBe("2026-08-10T06:00:00.000Z");
  });

  it("leaves a task that has already run alone", () => {
    const ranAt = "2026-08-09T18:00:00.000Z";
    const states: StateMap = new Map([
      [
        WORKLOG.id,
        {
          taskId: WORKLOG.id,
          lastRunAt: ranAt,
          lastRunResult: null,
          lastRunDurationMs: null,
          lastErrorMessage: null,
          consecutiveFailures: 0,
          totalRuns: 3,
          nextScheduledAt: null,
        },
      ],
    ]);

    expect(seedStates(states, [WORKLOG], BOOT)).toEqual([]);
    expect(states.get(WORKLOG.id)?.lastRunAt).toBe(ranAt);
  });

  // An entry with no lastRunAt is in the same never-caught-up loop as no entry at all, so it
  // gets a starting point — without discarding what the entry already knows.
  it("gives an entry that has no starting point one, keeping its history", () => {
    const states: StateMap = new Map([
      [
        WORKLOG.id,
        {
          taskId: WORKLOG.id,
          lastRunAt: null,
          lastRunResult: null,
          lastRunDurationMs: null,
          lastErrorMessage: "boom",
          consecutiveFailures: 2,
          totalRuns: 5,
          nextScheduledAt: null,
        },
      ],
    ]);

    expect(seedStates(states, [WORKLOG], BOOT)).toEqual([WORKLOG.id]);
    expect(states.get(WORKLOG.id)?.lastRunAt).toBe(BOOT.toISOString());
    expect(states.get(WORKLOG.id)?.totalRuns).toBe(5);
    expect(states.get(WORKLOG.id)?.consecutiveFailures).toBe(2);
  });
});

describe("what the seed buys: a window missed with the server down is caught up", () => {
  it("un-seeded — the bug: no state, so nothing is ever owed", () => {
    const plan = computeCatchUpPlan([catchUpTask], new Map(), SEVEN_HOURS_LATER.getTime());
    expect(plan.runs).toEqual([]);
  });

  it("seeded — the 06:00 window the server slept through comes back as a catch-up run", () => {
    const states: StateMap = new Map();
    seedStates(states, [WORKLOG], BOOT);

    const plan = computeCatchUpPlan([catchUpTask], states, SEVEN_HOURS_LATER.getTime());

    expect(plan.runs.map((run) => run.context.scheduledFor)).toEqual(["2026-08-10T06:00:00.000Z"]);
    expect(plan.runs[0].context.trigger).toBe("catch-up");
  });
});

describe("seedSchedulerState", () => {
  it("writes the state file the adapter reads, then has nothing left to do", async () => {
    const workspace = makeWorkspace();

    expect(await seedSchedulerState(workspace, [WORKLOG], BOOT)).toEqual([WORKLOG.id]);
    const written: Record<string, { lastRunAt: string }> = JSON.parse(await readFile(schedulerStateFilePath(workspace), "utf-8"));
    expect(written[WORKLOG.id].lastRunAt).toBe(BOOT.toISOString());

    // Second boot: the entry is there, so the clock is not reset — which is the whole point.
    expect(await seedSchedulerState(workspace, [WORKLOG], SEVEN_HOURS_LATER)).toEqual([]);
    const reread: Record<string, { lastRunAt: string }> = JSON.parse(await readFile(schedulerStateFilePath(workspace), "utf-8"));
    expect(reread[WORKLOG.id].lastRunAt).toBe(BOOT.toISOString());
  });
});
