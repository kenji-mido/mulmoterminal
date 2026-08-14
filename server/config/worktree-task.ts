// Which managed worktree a directory is in, decided from the path alone.
//
// Its own module because two unrelated things ask it — the header's `task` field and the
// per-tree environment reservation (#1367) — and the second cannot import the first without a
// cycle through git/worktrees.ts. A path rule, no disk, no git.
import path from "node:path";
import { isStrictlyWithin } from "../infra/path-within.js";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";

/** The managed worktree root. */
export const worktreesRootDir = (): string => path.join(mulmoterminalHome(), "worktrees");

// A managed worktree lives at <root>/<repo>-<hash>/<task>. The task is the FIRST segment
// under <root> — NOT path.basename, which would return the wrong name for any cwd deeper
// than the task dir itself (a session working in <task>/src would read as "src"). Root is a
// parameter so the rule is unit-testable without the real home dir.
export function worktreeTask(cwd: string, root: string = worktreesRootDir()): string | null {
  if (!isStrictlyWithin(root, cwd)) return null;
  // segments[0] = "<repo>-<hash>", segments[1] = "<task>", anything after is inside the task.
  const segments = path.relative(path.resolve(root), path.resolve(cwd)).split(path.sep);
  return segments[1] ?? null;
}
