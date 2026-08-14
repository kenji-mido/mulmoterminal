// What a managed worktree's path says about it, for the two sides that both have to ask.
//
// In `common/` because the launch form and `mulmoterminal init` each decide from it — the browser
// records the directory a cell launched in, the CLI seeds the same list from Claude's history — and
// a rule mirrored into `src/` and `server/` is a rule that drifts.

import { dirPathKey } from "./dirPathKey.js";

// A managed worktree lives at <root>/<repo>-<8hex>/<task> (see the server's `worktreesRoot`).
const MANAGED_DIR = /^(.+)-[0-9a-f]{8}$/;

/**
 * The repo and task to CALL a worktree path, for a header that would otherwise show a long managed
 * path. Shape alone, with no idea where the managed root is — which is why it is only ever used to
 * name something. Getting it wrong shows a label; it decides nothing.
 */
export function worktreeLabel(cwd: string | null): { repo: string; task: string } | null {
  if (!cwd) return null;
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  const i = parts.indexOf("worktrees");
  const dir = parts[i + 1];
  const task = parts[i + 2];
  if (i < 0 || !dir || !task) return null;
  const m = MANAGED_DIR.exec(dir);
  return m?.[1] === undefined ? null : { repo: m[1], task };
}

/**
 * Whether this directory is one WE created — asked before recording it as a working-directory
 * preset, which a worktree must never become: it is one branch for one task, deleted when the task
 * is done, and nothing prunes the chip when the directory goes (the close button is the only
 * remover), so the row filled with paths that no longer exist.
 *
 * Anchored on the managed ROOT, not on the shape above. Shape alone matches any
 * `…/worktrees/<name>-<8hex>/<task>` a person or another tool happens to have, and the cost here is
 * not a wrong label — it is a real working directory silently missing from the launcher (Codex on
 * #1543). The root is the same authority the server's own `worktreeTask` uses; the browser is told
 * it by `/api/config`.
 *
 * **An unknown root answers `false`** — record the directory. Before `/api/config` resolves there is
 * nothing to compare against, and of the two ways to be wrong, an extra chip the user can delete
 * beats a directory that quietly never appears.
 *
 * Lexical containment (`dirPathKey`), because the browser has no filesystem: it folds both
 * separators, `.`/`..` and a trailing slash, but not a symlink or Windows' case-insensitivity.
 * Both values come from the same server, so they agree in practice — and a spelling it cannot fold
 * falls back to "not ours", which is the safe direction above.
 */
export function isManagedWorktreePath(cwd: string | null | undefined, worktreesRoot: string | null | undefined): boolean {
  if (!cwd || !worktreesRoot) return false;
  const rootKey = dirPathKey(worktreesRoot);
  if (rootKey === "") return false;
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  const key = dirPathKey(cwd);
  if (!key.startsWith(prefix)) return false;
  const below = key.slice(prefix.length).split("/").filter(Boolean);
  // `<repo>-<hash>/<task>` at least, and the first segment has to be a name WE mint. The root
  // holds worktrees but is not one, the per-repo directory above a task is not one either, and a
  // directory someone put under the root by hand carries no hash — all three are places a person
  // could reasonably be working, and dropping one loses it from the launcher (Codex on #1543).
  return below.length >= 2 && MANAGED_DIR.test(below[0] ?? "");
}
