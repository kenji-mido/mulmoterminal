// Walking up a process tree, which is the only channel muse leaves open for a plugin's MCP server
// to say where it came from (see server/session/bridge-session.ts).
//
// `ps` rather than anything native: it is on every platform this app runs on, the read is a few
// milliseconds, and it happens once per bridge process rather than per call.
import { spawnCapture } from "./spawnCapture.js";

// A bridge sits two or three processes below its pane (bridge -> muse -> pane). Eight is far
// enough to absorb a wrapper or two and short enough that a cycle — which `ps` should never
// report, but a bound is cheaper than trusting it — cannot spin.
const MAX_DEPTH = 8;

/** The parent of a pid, or null when `ps` cannot say (the process is gone, or we may not look). */
export function parentPid(pid: number): number | null {
  const { status, stdout } = spawnCapture("ps", ["-o", "ppid=", "-p", String(pid)]);
  if (status !== 0) return null;
  const parent = Number(stdout.trim());
  return Number.isInteger(parent) && parent > 1 ? parent : null;
}

/**
 * A pid and its ancestors, nearest first, stopping at the root of the tree.
 *
 * `seen` guards against a cycle rather than the depth alone, so a repeated pid ends the walk
 * instead of filling the list with one value the caller would then match on.
 */
export function ancestorPids(pid: number, parentOf: (pid: number) => number | null = parentPid): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | null = pid;
  while (current !== null && current > 1 && chain.length < MAX_DEPTH && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parentOf(current);
  }
  return chain;
}
