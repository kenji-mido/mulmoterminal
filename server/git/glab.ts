// Shared `glab` CLI runner, the GitLab sibling of gh.ts (#981). Same shape on purpose: the CLI's
// own login is the auth, args are argv only (no shell), and a failing repo yields a per-repo error
// rather than sinking the view.
//
// CLI delegation rather than the REST API, matching `gh`: it keeps this app from holding a token
// of its own — the one place that reads a token, the sandbox, already asks the CLI for it.
import { spawnCollect } from "./spawn-collect.js";
import type { GhResult } from "./gh.js";
import { projectPath, type RemoteForge } from "./forge-host.js";

/** The `gh.ts` sentinel's twin — see GH_MISSING_STDERR for why it is named. */
export const GLAB_MISSING_STDERR = "glab not found (install the GitLab CLI and run `glab auth login`)";

export function runGlab(args: string[]): Promise<GhResult> {
  return spawnCollect("glab", args, { errorStderr: GLAB_MISSING_STDERR });
}

/** A GitLab project as `glab` has to be addressed about it. Two spellings, because the CLI wants a
 *  different one in each place — see `glabTarget` for why they are not interchangeable. */
export interface GlabTarget {
  /** The hostname, for `glab api --hostname`. */
  host: string;
  /** The project path the REST API names (`group/subgroup/project`), for an `api` endpoint. */
  project: string;
  /** What `--repo` must be given. */
  repo: string;
}

/** How to address `glab` about a project on this forge.
 *
 *  `--repo` gets a URL, always, INCLUDING gitlab.com. `glab` reads a bare `host/group/project` as a
 *  project PATH on its default host, not as a host: measured against glab 1.111.0,
 *  `--repo gitlab.nonexistent.invalid/group/project` asked gitlab.com for a project by that name
 *  and answered 404, while the same value as an https URL dialled the host in it. A self-hosted
 *  project addressed the short way is therefore not an error the user can see — it is somebody
 *  else's server answering (#1332).
 *
 *  gitlab.com takes the same URL rather than the short form so there is ONE rule here. A branch
 *  that only the majority host walks is a branch nobody tests.
 */
export const glabTarget = (forge: RemoteForge): GlabTarget => {
  const project = projectPath(forge) ?? forge.path;
  return { host: forge.host, project, repo: `https://${forge.host}/${project}` };
};

// `-F json` on `mr list` is the OUTPUT FORMAT; on `issue list` that same short flag means something
// else entirely (`--output-format` = details|ids|urls) and the format flag is `-O`. Verified
// against glab 1.111.0 — writing these from memory produces a command that runs and returns the
// wrong thing.
// State: neither list is given a state flag. `mr list` has none to give (its help documents the
// open default), and `issue list`'s `--opened` is DEPRECATED — running it prints "Flag --opened has
// been deprecated, default if --closed is not used", which both states the default and warns that
// the flag is going away. Learned by running it, not from the help.
export const glabMrListArgs = (target: GlabTarget, limit: number): string[] => ["mr", "list", "--repo", target.repo, "--per-page", String(limit), "-F", "json"];

export const glabIssueListArgs = (target: GlabTarget, limit: number): string[] => [
  "issue",
  "list",
  "--repo",
  target.repo,
  "--per-page",
  String(limit),
  "-O",
  "json",
];

// `issue view` takes `-F` for the output format — like `mr list`, and UNLIKE `issue list`, which
// takes `-O` and gives `-F` a different meaning entirely. Three subcommands, three answers;
// verified against glab 1.111.0 rather than pattern-matched from its sibling.
export const glabIssueViewArgs = (target: GlabTarget, issue: number): string[] => ["issue", "view", String(issue), "--repo", target.repo, "-F", "json"];

// `note`, not `comment` — and the message flag is `-m`. Checked against glab 1.111.0.
export const glabIssueNoteArgs = (target: GlabTarget, issue: number, body: string): string[] => [
  "issue",
  "note",
  String(issue),
  "--repo",
  target.repo,
  "-m",
  body,
];

export const glabIssueCloseArgs = (target: GlabTarget, issue: number): string[] => ["issue", "close", String(issue), "--repo", target.repo];

// Editing a note has no `glab issue` subcommand at all (1.111.0 offers `note` to ADD one and
// nothing to change it), so this goes through the REST API — `PUT .../notes/:id`, the endpoint the
// notes reader above already talks to.
//
// `--raw-field` rather than `--field`: the typed one converts `@file` and the bare words
// true/false/null, and a comment body is neither ours to convert nor guaranteed not to start with
// an `@`. `--method` is explicit because passing a field otherwise switches glab to POST.
export const glabIssueNoteEditArgs = (target: GlabTarget, issue: number, noteId: string, body: string): string[] => [
  "api",
  "--hostname",
  target.host,
  "--method",
  "PUT",
  `projects/${encodeURIComponent(target.project)}/issues/${issue}/notes/${noteId}`,
  "--raw-field",
  `body=${body}`,
];

// Existing comments do NOT come back from `issue view -F json`, and `--comments` only affects the
// human-readable output. The REST notes endpoint is where they are, so this is one extra call that
// the GitHub path does not make.
//
// `--paginate` is not optional here. A page holds 20 notes and they arrive NEWEST FIRST, so a
// single page drops the OLDEST — and a work comment is written when work starts, which is exactly
// the end that falls off. Missing it means writing the comment again on an issue that has one
// (Codex review). Measured on a real 23-note issue: one page returned 20, `--paginate` returned all
// 23 as a single JSON array, not concatenated pages.
//
// `--hostname` rather than a URL: `api` takes a PATH, and without the flag it asks gitlab.com
// (or the authenticated host of whatever directory the server happens to be in) — documented in
// its own help, and the reason `--repo`'s URL cannot be reused here.
export const glabIssueNotesArgs = (target: GlabTarget, issue: number): string[] => [
  "api",
  "--hostname",
  target.host,
  `projects/${encodeURIComponent(target.project)}/issues/${issue}/notes`,
  "--paginate",
];

// The merge-request half. Like `gh`, glab infers the project from the working directory, so none of
// these pass `--repo` — verified by running `glab mr list` in a directory holding nothing but a
// remote. A URL is accepted wherever an iid is, which is what lets the body helpers keep taking the
// URL they were given.
//
// `--fill` differs from `gh pr create --fill` in one way that matters: it PUSHES the branch too
// (observed — an unpushed branch produced a merge request). Harmless after `pushWorktree` has
// already pushed, and it is what makes the command work at all when the push was skipped.
export const glabMrCreateArgs = (base: string, branch: string): string[] => [
  "mr",
  "create",
  "--fill",
  "--source-branch",
  branch,
  "--target-branch",
  base,
  "--yes",
];

// `target` is optional because the two callers differ: ⧉ Open PR runs INSIDE the worktree and
// lets glab infer the project from the remote, while the roster's phase lookup has only a repo
// name and no directory to run in. Omitting `--repo` in the second case would ask glab about
// whatever directory the server happens to be in.
const repoArgs = (target?: GlabTarget): string[] => (target ? ["--repo", target.repo] : []);

export const glabMrForBranchArgs = (branch: string, target?: GlabTarget): string[] => [
  "mr",
  "list",
  "--source-branch",
  branch,
  ...repoArgs(target),
  "-F",
  "json",
];

export const glabMrViewArgs = (mr: string, target?: GlabTarget): string[] => ["mr", "view", mr, ...repoArgs(target), "-F", "json"];

export const glabMrUpdateBodyArgs = (mr: string, body: string): string[] => ["mr", "update", mr, "--description", body];
