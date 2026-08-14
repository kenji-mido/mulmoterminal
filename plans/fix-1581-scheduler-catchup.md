# fix #1581 — system tasks need persistence + startup catch-up

## What is broken

`initUserTaskScheduler` (`server/backends/scheduler.ts`) creates a task-manager and calls
`registerTask()` for system tasks and user tasks alike. It never calls
`configureScheduler()` / `initScheduler()` from `@mulmoclaude/core/scheduler`, so there is
no state file, no execution log, and no catch-up.

The task-manager's `isDue()` fires an interval schedule only on UTC-midnight-aligned
boundaries. A 6-hour worklog can therefore fire only during the one tick minute at
00:00 / 06:00 / 12:00 / 18:00 UTC. A server started with `npx` — off overnight, asleep,
restarted — misses that minute and the run is skipped **forever**: nothing records that a
window passed, so nothing can make it up. The reporter had `worklogEnabled: true` for days
with no page, no state file and no error.

## What MulmoClaude does (the target)

`server/index.ts:1246` → `server/events/scheduler-adapter.ts` → `initScheduler()`:

1. loads `config/scheduler/state.json` (per-task `lastRunAt`),
2. `computeCatchUpPlan()` enumerates every window missed since `lastRunAt`,
3. runs them per the task's `missedRunPolicy` (`skip` / `run-once` / `run-all`, capped at 24),
4. registers the tasks on the task-manager for ongoing ticks,
5. records every run — state + a log line under `data/scheduler/logs/`.

User and skill tasks there are NOT caught up (they register directly on the task-manager),
but each run is recorded through `recordExternalRun` so history and last/next-run exist.

## Plan

Adopt that path. The shared package is already a dependency (`@mulmoclaude/core@^3.0.0`,
`@receptron/task-scheduler@^1.0.3`) and `feedRefreshTaskDef()` / `googleCalendarSyncTaskDef()`
already return the richer `SystemTaskDef` — this host was throwing the extra fields away.

1. **`server/backends/scheduler-adapter.ts`** (new) — bind `configureScheduler` to this host's
   workspace root, `writeFileAtomic` and logger, mirroring MulmoClaude's file of the same name.
2. **Seed never-run tasks before `initScheduler` loads the state file**
   (`server/backends/scheduler-state-seed.ts`, new). `computeCatchUpPlan` treats a task with no
   state as "just registered" and catches nothing up — and since nothing is then written, the
   next boot is "just registered" again. A 6-hour task on a laptop would stay in that loop
   forever, which is the reported bug surviving its own fix. Seeding `lastRunAt` = boot time
   (with `totalRuns: 0`, so nothing claims a run happened) starts the accounting, and the boot
   after a missed window catches it up. Seeding runs BEFORE `initScheduler` because the adapter
   holds the state map in memory and rewrites the whole file on each save — a later external
   write would be clobbered.
3. **`worklogSystemTask` returns `SystemTaskDef`** — `name` + `missedRunPolicy: run-once`.
   `run-once` because the batch's own window is `[lastRunAt, now]` from
   `config/scheduler/worklog-state.json`: one catch-up run covers everything missed.
4. **`initUserTaskScheduler`** registers user tasks directly (as MulmoClaude does) and hands the
   system tasks to `initScheduler`, fire-and-forget so a slow catch-up cannot block boot.
5. **User-task runs are recorded** (`server/backends/scheduled-run.ts`, new) via
   `recordExternalRun`, keyed `user.<id>`. MulmoTerminal has the same completion-hook seam
   MulmoClaude uses (`server/session/completion-hooks.ts`), so the recorded verdict is the
   turn's real outcome, not merely "dispatch succeeded". `spawnScheduledWorker` gains an
   `onComplete` hook — the map holds ONE hook per session, so the recorder has to share the
   existing `markFailedWorker` one rather than register a second and silently replace it.
6. **API**: `GET /api/scheduler/tasks` returns system + user tasks with their execution state and
   an `origin` tag, and `GET /api/scheduler/logs` (`since` / `taskId` / `limit`, capped 500) is
   added — both shaped exactly like MulmoClaude's `server/api/routes/schedulerTasks.ts`, which is
   the naming authority. Task CRUD stays out (a separate parity item).

## Deliberately not in scope

- Task CRUD routes and a tasks UI (`docs/mulmoclaude-parity.md` item 2).
- The interval-anchoring quirk itself: catch-up windows are epoch-anchored while `isDue` is
  UTC-midnight-anchored. They agree for any interval dividing 24 h (1, 2, 3, 4, 6, 8, 12, 24);
  an interval like 5 h ticks only at 00:00 UTC and is otherwise reached by catch-up at boot.
  That lives in the shared engine and affects MulmoClaude identically.

## Verification

- Specs for: seeding (first boot writes state, second boot with a missed window catches up,
  a task that already has state is left alone), `SystemTaskDef` shape of the worklog task,
  user-task run recording, and the two routes.
- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`.
- Manual: enable the worklog with a 1-hour interval, let a window pass with the server down,
  restart, and confirm the catch-up run fires and `config/scheduler/state.json` advances.
