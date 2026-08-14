// Where a scheduled feed refresh's worker runs.
//
// One line of the spawn, in its own file, because getting it wrong is silent and expensive: the
// agent-ingest seed prompt addresses the collection's records ROOT-RELATIVELY (core's
// `promptPathsFor` emits the schema's `dataPath` verbatim), so the worker's CWD is what decides
// which project it writes into. Started in the wrong directory it resolves
// `data/collections/<slug>/items` against that one instead — both paths exist, neither side
// errors, and a project's refresh quietly fills the workspace's same-named collection.
//
// That is not hypothetical: per-project feed refresh shipped once and was REVERTED for exactly
// this (#1582), because the runner was handed no root to spawn in. core 3.2.0 forwards it, and
// this is where it lands.
import type { SpawnClaudeOptions } from "../session/spawn-claude.js";

/** The spawn options for an agent-ingest worker refreshing `workspaceRoot`.
 *
 *  An ABSENT root means the host's own workspace — a single-workspace host, and every refresh
 *  before projects existed — and leaves the spawn exactly as it was rather than naming a cwd the
 *  spawner would then have to interpret. */
export function feedWorkerSpawnOptions(message: string, workspaceRoot?: string): SpawnClaudeOptions {
  return { initialPrompt: message, ...(workspaceRoot ? { cwd: workspaceRoot } : {}) };
}
