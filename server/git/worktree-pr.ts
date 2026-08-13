// Outward-facing worktree actions (the "取り込み" half): push the worktree's branch
// and open/create a PR. PR creation prefers `gh pr create`; when gh is missing or
// unauthed it falls back to opening the GitHub compare URL in the browser. Guarded
// upstream by origin checks; here every command is argv-only (no shell).
import { repoRoot, defaultBaseBranch, isManagedWorktree, git } from "./worktrees.js";
import { resolveGithubUrl } from "./gitRemote.js";
import { spawnCollect, type SpawnResult } from "./spawn-collect.js";
import { lastGhUrl } from "./git-parse.js";
import { parsePrUrl } from "./pr-for-branch.js";
import { getPrWorkdirFooter } from "../config/config-routes.js";
import { withFooter, withIssueRef, workdirFooter } from "./pr-footer.js";
import { issueFromAnchoredBranch } from "../../common/prPhase.js";

type Reason = "not-worktree" | "no-branch" | "no-remote" | "no-github" | "push-failed" | "failed";

export interface PushResult {
  ok: boolean;
  branch?: string;
  reason?: Reason;
  detail?: string;
}
export interface PrResult {
  ok: boolean;
  url?: string | undefined;
  via?: "gh" | "compare";
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
export type Runner = (cmd: "git" | "gh", args: string[], cwd: string) => Promise<SpawnResult>;

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
// adding to it — so the body has to be read back and edited. ONE read and at most one write for
// both lines: two independent read-modify-writes against the same body would race each other.
//
// Never fails the PR: the PR exists by the time this runs, and reporting an error for a missing
// trailing line would tell the user their PR wasn't created when it was.
export async function finalizePrBody(prUrl: string, additions: PrBodyAdditions, cwd: string, runner: Runner = run): Promise<void> {
  const { footer, issue } = additions;
  if (!footer && issue === null) return;
  const viewed = await runner("gh", ["pr", "view", prUrl, "--json", "body", "--jq", ".body"], cwd);
  if (!viewed.ok) {
    console.warn(`[pr] could not read the body of ${prUrl} to append "${describeAdditions(additions)}": ${viewed.stderr.trim().slice(0, DETAIL_LIMIT)}`);
    return;
  }
  // Issue reference first, clone line last: the latter is a FOOTER, and appending `Fixes #N`
  // after it would bury it mid-body.
  const referenced = issue === null ? viewed.stdout : withIssueRef(viewed.stdout, issue);
  const body = footer ? withFooter(referenced, footer) : referenced;
  // Both helpers return their input unchanged when the line is already there, so this is the
  // "nothing to say" case — don't spend a write (and a PR-edited event) saying it.
  if (body === viewed.stdout) return;
  const edited = await runner("gh", ["pr", "edit", prUrl, "--body", body], cwd);
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

  const gh = await run("gh", ["pr", "create", "--base", base, "--head", branch, "--fill"], cwd);
  const ghUrl = gh.ok ? lastGhUrl(gh.stdout) : null;
  if (ghUrl) {
    // Only on the PR we just created: rewriting the body of an EXISTING PR every time the button
    // is pressed would edit whatever the author has since written there.
    await finalizePrBody(ghUrl, { footer: getPrWorkdirFooter() ? workdirFooter(repo) : null, issue: issueFromAnchoredBranch(branch) }, cwd);
    return { ok: true, url: ghUrl, via: "gh" };
  }

  // `gh pr create` fails when a PR for this branch ALREADY exists — re-running the button
  // should open that PR, not the "open a new PR" compare page. Look it up before falling back.
  // No `--repo`: like the `gh pr create` above, gh infers the repo from `cwd` (the worktree).
  // Passing repoRoot(cwd) here would be a filesystem PATH, but `--repo` only accepts an
  // OWNER/REPO slug, so it would always error and defeat this lookup.
  const existing = await run("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"], cwd);
  const existingUrl = existing.ok ? parsePrUrl(existing.stdout) : null;
  if (existingUrl) return { ok: true, url: existingUrl, via: "gh" };

  const githubUrl = await resolveGithubUrl(cwd);
  if (!githubUrl) return { ok: false, reason: "no-github", detail: gh.stderr.trim().slice(0, DETAIL_LIMIT) };
  return { ok: true, url: compareUrl(githubUrl, base, branch), via: "compare" };
}
