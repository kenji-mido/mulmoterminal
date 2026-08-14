// Keep a file WE write out of the user's `git status`, through `.git/info/exclude` rather than
// their `.gitignore`: these are local switches on a local machine, so they must not turn up in a
// diff or be pushed to their team — the same reason claude's MCP registration uses `-s local`
// scope (infra/gui-mcp-registration.ts).
//
// Shared by the agents whose GUI MCP registration lands INSIDE the project: agy's
// `.agents/mcp_config.json` and `.agents/skills.json`, and grok's `.grok/config.toml`.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// The `info` directory whose `exclude` file THIS checkout's `git status` reads, or null when
// there is nothing to resolve (no `.git` here — a session running below the repo root).
//
// A plain checkout keeps `.git` as a directory and reads `.git/info/exclude`. A linked WORKTREE
// keeps `.git` as a FILE naming its private gitdir — and git reads excludes from the COMMON
// dir, which the `commondir` file inside that gitdir points to (measured on git 2.x: an
// `info/exclude` placed in the per-worktree gitdir is ignored). That common file is shared by
// every worktree of the repo, which is fine — the entries we add name the same generated files
// in each of them. A SUBMODULE's `.git` file names its gitdir under the superproject's
// `.git/modules/`, which has no `commondir` and IS the dir git reads.
function gitInfoDir(cwd: string): string | null {
  const dotGit = path.join(cwd, ".git");
  const st = statSync(dotGit, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.isDirectory()) return path.join(dotGit, "info");
  const named = /^gitdir:(.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
  if (!named) return null;
  const gitdir = path.resolve(cwd, named.trim());
  const commondir = path.join(gitdir, "commondir");
  const common = existsSync(commondir) ? path.resolve(gitdir, readFileSync(commondir, "utf8").trim()) : gitdir;
  return path.join(common, "info");
}

/**
 * Add `entry` to the `info/exclude` this checkout's `git status` actually reads, if there is
 * one. Idempotent. Covers a plain checkout, a linked worktree and a submodule (see
 * `gitInfoDir`); a directory below the repo root, where `./.git` names nothing, is left alone
 * rather than guessed at — the cost is a line in `git status`, not a broken session.
 */
export function excludeFromGit(cwd: string, entry: string): void {
  try {
    const info = gitInfoDir(cwd);
    if (!info || !existsSync(info)) return;
    const exclude = path.join(info, "exclude");
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (current.split("\n").includes(entry)) return;
    writeFileSync(exclude, current + (current === "" || current.endsWith("\n") ? "" : "\n") + entry + "\n", "utf8");
  } catch {
    // Not ours to insist on. The config itself is already written; this only affects tidiness.
  }
}
