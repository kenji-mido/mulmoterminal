// Outward-facing worktree actions (the "取り込み" half): push the worktree's branch
// and open/create a PR. PR creation prefers `gh pr create`; when gh is missing or
// unauthed it falls back to opening the GitHub compare URL in the browser. Guarded
// upstream by origin checks; here every command is argv-only (no shell).
import { repoRoot, defaultBaseBranch, isManagedWorktree, git } from "./worktrees.js";
import { repoForDir } from "./forge-support.js";
import { glabMrCreateArgs, glabMrForBranchArgs, glabMrUpdateBodyArgs, glabMrViewArgs } from "./glab.js";
import { glabFirstMrUrl, glabMrBody } from "./glab-items.js";

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
import { spawnCollect, type SpawnResult } from "./spawn-collect.js";
import { lastGhUrl } from "./git-parse.js";
import { parsePrUrl } from "./pr-for-branch.js";
import { getPrWorkdirFooter } from "../config/config-routes.js";
import { withFooter, withIssueRef, workdirFooter } from "./pr-footer.js";
import { issueFromAnchoredBranch } from "../../common/prPhase.js";

// `no-forge` was `no-github` until #981: the message it drove said "Not a GitHub repo" about a
// GitLab one, which is both wrong and unhelpful — the push HAD succeeded and the user needed to
// know where to go, not what their repo is not.
type Reason = "not-worktree" | "no-branch" | "no-remote" | "no-forge" | "push-failed" | "failed";

export interface PushResult {
  ok: boolean;
  branch?: string;
  reason?: Reason;
  detail?: string;
}
export interface PrResult {
  ok: boolean;
  url?: string | undefined;
  /** How the URL was produced: a CLI made or found the request, or we fell back to the forge's
   *  compare page. Named for the OUTCOME rather than the tool since #981 — `glab` reaching this
   *  point would otherwise have to report itself as "gh". */
  via?: "cli" | "compare";
  reason?: Reason | undefined;
  detail?: string | undefined;
}

const DETAIL_LIMIT = 500;

// `git push` and `gh pr create` are outward network mutations that can legitimately take
// minutes on a large branch or a slow remote — far longer than spawnCollect's default,
// which is tuned for quick `gh` reads. Give them a generous ceiling so a real push isn't
// killed at 30s and mis-reported as push-failed, while still bounding a truly-stuck process.
export const NETWORK_MUTATION_TIMEOUT_MS = 300_000;

// worktrees.ts' git() drops stderr and only runs git; push/gh failures report via
// stderr, so use the stderr-capturing runner, constrained to those two tools.
// `glab` joins `gh` here rather than the type naming one forge (#981). Which of them a worktree
// wants is decided from its own remote, so the runner just has to be able to spawn either.
export type Runner = (cmd: "git" | "gh" | "glab", args: string[], cwd: string) => Promise<SpawnResult>;

const run: Runner = (cmd, args, cwd) => spawnCollect(cmd, args, { cwd, errorStderr: "spawn failed", timeoutMs: NETWORK_MUTATION_TIMEOUT_MS });

async function currentBranch(cwd: string): Promise<string | null> {
  const res = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = res.stdout.trim();
  return res.ok && branch && branch !== "HEAD" ? branch : null;
}

async function hasOrigin(cwd: string): Promise<boolean> {
  const res = await git(["remote"], cwd);
  return (
    res.ok &&
    res.stdout
      .split("\n")
      .map((r) => r.trim())
      .includes("origin")
  );
}

// The GitHub "open a PR" page for base...branch. Branch names keep their slash
// (agent/<task>) — GitHub's compare path takes them raw, not percent-encoded.
export function compareUrl(githubUrl: string, base: string, branch: string): string {
  return `${githubUrl}/compare/${base}...${branch}?expand=1`;
}

// GitLab's equivalent, and it is NOT a compare page: the project's "New merge request" form,
// pre-filled with the source branch. This is the URL GitLab itself prints on `git push` — copied
// from a real push rather than composed from the docs, including the bracket encoding.
export function newMergeRequestUrl(projectUrl: string, branch: string): string {
  return `${projectUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`;
}

// Push the worktree's branch to origin (so it can be turned into a PR).
export async function pushWorktree(cwd: string): Promise<PushResult> {
  const repo = await repoRoot(cwd);
  if (!repo || !isManagedWorktree(repo, cwd)) return { ok: false, reason: "not-worktree" };
  const branch = await currentBranch(cwd);
  if (!branch) return { ok: false, reason: "no-branch" };
  if (!(await hasOrigin(cwd))) return { ok: false, reason: "no-remote" };
  const pushed = await run("git", ["push", "-u", "origin", branch], cwd);
  return pushed.ok ? { ok: true, branch } : { ok: false, reason: "push-failed", detail: pushed.stderr.trim().slice(0, DETAIL_LIMIT) };
}

/** The trailing lines to put in a PR body: which clone the work happened in, and which issue
 *  merging it closes. Either may be absent — the footer when the setting is off or the clone name
 *  has nothing printable in it, the issue when the branch isn't anchored to one. */
export interface PrBodyAdditions {
  footer: string | null;
  issue: number | null;
}

const describeAdditions = ({ footer, issue }: PrBodyAdditions): string => [issue === null ? null : `Fixes #${issue}`, footer].filter(Boolean).join(" / ");

// Add those lines to a PR body that already exists (#872, #1171). Two calls rather than one,
// because `--body` on `gh pr create` REPLACES what `--fill` derived from the commits instead of

// How one forge phrases the four merge-request operations. Chosen once per call from the worktree's
// own remote, because all four concern the SAME merge request — mixing them would read one and
// write another.
interface PrOps {
  cli: "gh" | "glab";
  create: (base: string, branch: string) => string[];
  forBranch: (branch: string) => string[];
  viewBody: (prUrl: string) => string[];
  /** How to read the body out of `viewBody`'s stdout. gh is asked for the raw string with `--jq`;
   *  glab has no such flag, so its JSON is parsed here. */
  readBody: (stdout: string) => string;
  /** The existing merge request's URL out of `forBranch`'s stdout, or null when there is none. */
  readUrl: (stdout: string) => string | null;
  updateBody: (prUrl: string, body: string) => string[];
}

const GITHUB_PR_OPS: PrOps = {
  cli: "gh",
  create: (base, branch) => ["pr", "create", "--base", base, "--head", branch, "--fill"],
  forBranch: (branch) => ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"],
  viewBody: (prUrl) => ["pr", "view", prUrl, "--json", "body", "--jq", ".body"],
  readBody: (stdout) => stdout,
  readUrl: (stdout) => parsePrUrl(stdout),
  updateBody: (prUrl, body) => ["pr", "edit", prUrl, "--body", body],
};

const GITLAB_PR_OPS: PrOps = {
  cli: "glab",
  create: (base, branch) => glabMrCreateArgs(base, branch),
  forBranch: (branch) => glabMrForBranchArgs(branch),
  viewBody: (prUrl) => glabMrViewArgs(prUrl),
  readBody: (stdout) => glabMrBody(safeJson(stdout)),
  readUrl: (stdout) => glabFirstMrUrl(safeJson(stdout)),
  updateBody: (prUrl, body) => glabMrUpdateBodyArgs(prUrl, body),
};

// Neither `gh` nor `glab` is told which project this is: both infer it from the working directory,
// which is why none of the argument builders pass `--repo`. Only the CHOICE of CLI comes from the
// remote (#981).
async function prOpsFor(cwd: string): Promise<PrOps> {
  const found = await repoForDir(cwd);
  return found?.forge.kind === "gitlab" ? GITLAB_PR_OPS : GITHUB_PR_OPS;
}

// adding to it — so the body has to be read back and edited. ONE read and at most one write for
// both lines: two independent read-modify-writes against the same body would race each other.
//
// Never fails the PR: the PR exists by the time this runs, and reporting an error for a missing
// trailing line would tell the user their PR wasn't created when it was.
export async function finalizePrBody(prUrl: string, additions: PrBodyAdditions, cwd: string, runner: Runner = run, ops?: PrOps): Promise<void> {
  const { footer, issue } = additions;
  if (!footer && issue === null) return;
  const forge = ops ?? (await prOpsFor(cwd));
  const viewed = await runner(forge.cli, forge.viewBody(prUrl), cwd);
  if (!viewed.ok) {
    console.warn(`[pr] could not read the body of ${prUrl} to append "${describeAdditions(additions)}": ${viewed.stderr.trim().slice(0, DETAIL_LIMIT)}`);
    return;
  }
  // Issue reference first, clone line last: the latter is a FOOTER, and appending `Fixes #N`
  // after it would bury it mid-body.
  const current = forge.readBody(viewed.stdout);
  const referenced = issue === null ? current : withIssueRef(current, issue);
  const body = footer ? withFooter(referenced, footer) : referenced;
  // Both helpers return their input unchanged when the line is already there, so this is the
  // "nothing to say" case — don't spend a write (and a PR-edited event) saying it.
  if (body === current) return;
  const edited = await runner(forge.cli, forge.updateBody(prUrl, body), cwd);
  if (!edited.ok) console.warn(`[pr] could not append "${describeAdditions(additions)}" to ${prUrl}: ${edited.stderr.trim().slice(0, DETAIL_LIMIT)}`);
}

// Push, then create a PR via gh — falling back to the GitHub compare URL when gh is
// absent/unauthed/errors. Returns the URL to open and which path produced it.
export async function createOrOpenPR(cwd: string): Promise<PrResult> {
  const pushed = await pushWorktree(cwd);
  if (!pushed.ok || !pushed.branch) return { ok: false, reason: pushed.reason, detail: pushed.detail };
  const branch = pushed.branch;
  const repo = await repoRoot(cwd);
  if (!repo) return { ok: false, reason: "not-worktree" };
  const base = await defaultBaseBranch(repo);

  const ops = await prOpsFor(cwd);
  const gh = await run(ops.cli, ops.create(base, branch), cwd);
  const ghUrl = gh.ok ? lastGhUrl(gh.stdout) : null;
  if (ghUrl) {
    // Only on the PR we just created: rewriting the body of an EXISTING PR every time the button
    // is pressed would edit whatever the author has since written there.
    await finalizePrBody(ghUrl, { footer: getPrWorkdirFooter() ? workdirFooter(repo) : null, issue: issueFromAnchoredBranch(branch) }, cwd, run, ops);
    return { ok: true, url: ghUrl, via: "cli" };
  }

  // `gh pr create` fails when a PR for this branch ALREADY exists — re-running the button
  // should open that PR, not the "open a new PR" compare page. Look it up before falling back.
  // No `--repo`: like the `gh pr create` above, gh infers the repo from `cwd` (the worktree).
  // Passing repoRoot(cwd) here would be a filesystem PATH, but `--repo` only accepts an
  // OWNER/REPO slug, so it would always error and defeat this lookup.
  const existing = await run(ops.cli, ops.forBranch(branch), cwd);
  const existingUrl = existing.ok ? ops.readUrl(existing.stdout) : null;
  if (existingUrl) return { ok: true, url: existingUrl, via: "cli" };

  // The CLI could not make or find the request, so fall back to the page where a person can. Which
  // page that is comes from the forge — `resolveGithubUrl` answers null for GitLab, so reusing it
  // here reported "Not a GitHub repo" about a GitLab repo and buried glab's real error, whatever it
  // was (Codex review).
  const detail = gh.stderr.trim().slice(0, DETAIL_LIMIT);
  const found = await repoForDir(cwd);
  const webUrl = found?.forge.webUrl;
  if (!webUrl) return { ok: false, reason: "no-forge", detail };
  const url = found.forge.kind === "gitlab" ? newMergeRequestUrl(webUrl, branch) : compareUrl(webUrl, base, branch);
  return { ok: true, url, via: "compare" };
}
