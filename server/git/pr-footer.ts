// The trailing lines this app maintains in a PR body: which clone the work happened in (#872),
// and which issue the PR closes (#1171). Several clones of the same repo run side by side
// (`mulmoclaude`, `mulmoclaude2`, …), and a PR on GitHub otherwise carries nothing that says
// which one produced it — nor, since `gh pr create --fill` copies the commits verbatim, anything
// that links it back to the issue the work started from.
import path from "node:path";
import { declaresClosingReference } from "../../common/prPhase.js";

// A clone name is a DIRECTORY name, and on POSIX that may contain newlines, tabs and control
// characters. The line goes into a PR body and — since #973 — into a session's system prompt, so
// a name carrying a line break could append instructions of its own there. Sanitised at the
// source, where the untrusted value enters, rather than at each place it is used.
const MAX_CLONE_NAME_CHARS = 64;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

function cloneName(repoRootPath: string): string {
  return path.basename(repoRootPath).replace(CONTROL_OR_FORMAT, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CLONE_NAME_CHARS).trim();
}

/** The line for a repo root, or null when the directory name has nothing usable left in it.
 *  `repoRoot()` returns the MAIN working tree even when called from a managed worktree, so this
 *  is the clone's name rather than the worktree's. */
export function workdirFooter(repoRootPath: string): string | null {
  const name = cloneName(repoRootPath);
  return name ? `work in ${name}` : null;
}

const appendParagraph = (body: string, line: string): string => {
  const trimmed = body.trimEnd();
  return trimmed === "" ? line : `${trimmed}\n\n${line}`;
};

/** `body` with the footer as its last line. Idempotent — re-running the PR button on a
 *  branch that already carries the line must not stack a second copy. */
export function withFooter(body: string, footer: string): string {
  const trimmed = body.trimEnd();
  // Per line, and tolerant of a trailing `\r`: a body round-tripped through GitHub can come
  // back CRLF, and a footer that failed to match there would be appended a second time.
  if (trimmed.split("\n").some((line) => line.trimEnd() === footer)) return body;
  return appendParagraph(body, footer);
}

/** `body` with `Fixes #issue`, so merging the PR closes the issue the work started from.
 *  Left alone when the body ALREADY declares a closing reference in EITHER form GitHub honours —
 *  `Fixes #12` or `Fixes https://…/issues/12`. Whatever the author (or the commits `--fill`
 *  copied) named is their statement about what this PR finishes, and a second keyword on top of
 *  it closes both issues on merge. */
export function withIssueRef(body: string, issue: number): string {
  return declaresClosingReference(body) ? body : appendParagraph(body, `Fixes #${issue}`);
}
