import { statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_CWD } from "./env.js";
import { canonicalDir } from "../infra/path-within.js";
import { cwdProblemMessage, diagnoseSpawnCwd } from "../infra/spawn-cwd.js";

// Validate a client-supplied workspace dir: an absolute path naming an existing directory, or
// null. There is deliberately no variant that answers the DEFAULT workspace for a directory it
// rejected — a caller that asked about one directory would then be handed another one's answer
// under the requested one's name, and a stale preset (a project since deleted) is exactly when
// that happens. Callers take `workspaceRequest` below and decide what to do about it.
// Canonical, not verbatim: this return value is the identity a directory is known by everywhere
// downstream — the PTY's cwd, the cwd echoed back to the cell, the key its dir-config
// subscription uses, and the path recorded as a launcher preset. `/a/b/` passes both guards
// below, so returning it unchanged made one directory into two names, and a `.mulmoterminal.json`
// change announced as `/a/b` never reached a cell that had launched as `/a/b/` (#1002).
// Canonicalize BEFORE the stat, so the directory that is checked is the one that is returned.
// The two disagree: `stat` resolves symlinks in the kernel, `path.resolve` is purely lexical, so
// `/x/link/../var` stats as `/var` (link -> /etc) while resolving to `/x/var`. Stat-then-resolve
// would hand back a path nothing had validated, and usually one that does not exist.
//
// Lexical and NOT realpath, deliberately: the announcing side of the dir-config channel spells
// the directory with `path.dirname`, which is lexical too, and canonicalizing only one side
// physically would re-open the very mismatch below.
export function existingWorkspace(cwd: string | null): string | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const dir = canonicalDir(cwd);
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null; // not a dir / doesn't exist
  }
}

export function existingWorkspaceFromQuery(cwd: unknown): string | null {
  return existingWorkspace(typeof cwd === "string" ? cwd : null);
}

// What a request asked for, with the two cases that used to be answered identically told apart:
// NO directory was named (the default workspace is then the right answer), and a directory WAS
// named but cannot be used. Folding the second into the first is what made a mistyped path, a
// preset whose project was deleted, and a path mangled in transit (#1146) all look alike — and
// what they looked like was "it just opened somewhere else" (#1151).
//
// `malformed` separates "this request cannot name a directory at all" (not a path, or a relative
// one) from "it names a directory that is not there" — a bad request versus a missing one, which
// is the difference an HTTP status is for.
export type WorkspaceRequest =
  { kind: "default"; cwd: string } | { kind: "resolved"; cwd: string } | { kind: "unusable"; requested: string; problem: string; malformed: boolean };

// Why a named directory cannot be used, in the words `SpawnCwdError` already says it in (#1078) —
// one wording for one condition, whether it surfaces as a refused spawn or a refused read.
//
// Absoluteness is this layer's own rule and not diagnoseSpawnCwd's: a child process resolves a
// relative cwd against OUR working directory perfectly well, so it is not a spawn problem — it is
// a client sending something no part of this app has a basis to interpret.
function unusableWorkspace(requested: string): WorkspaceRequest {
  if (!path.isAbsolute(requested))
    return { kind: "unusable", requested, problem: `${requested} is not an absolute path, so it names no directory on this machine.`, malformed: true };
  const dir = canonicalDir(requested);
  // The fallback covers the one case the diagnosis calls fine and `existingWorkspace` did not:
  // a probe that could not answer (a permission error, a broken mount). Saying so beats a
  // refusal with no reason attached.
  const problem = cwdProblemMessage(dir, diagnoseSpawnCwd(dir)) ?? `${dir} cannot be read, so it cannot be used as a working directory.`;
  return { kind: "unusable", requested, problem, malformed: false };
}

// Every `?cwd=` route reads the query the same way. An ABSENT param (and an empty one, which is
// how a browser spells the same thing) asks for no particular directory. Anything else was asked
// for on purpose — including a non-string, which is what `?cwd=a&cwd=b` arrives as — so it is
// answered about or refused, never quietly swapped for the default.
export function workspaceRequest(cwd: unknown): WorkspaceRequest {
  if (cwd === undefined || cwd === null || cwd === "") return { kind: "default", cwd: CLAUDE_CWD };
  if (typeof cwd !== "string")
    return { kind: "unusable", requested: String(cwd), problem: "The working directory must be given exactly once, as a path.", malformed: true };
  const resolved = existingWorkspace(cwd);
  return resolved ? { kind: "resolved", cwd: resolved } : unusableWorkspace(cwd);
}
