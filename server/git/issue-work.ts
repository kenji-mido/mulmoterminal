// Starting work on a GitHub issue (#1173): read the issue, cut a worktree anchored to it, and
// seed a session in that worktree with the issue in its input box.
//
// One operation rather than three calls from the browser, because the steps are not independent:
// a worktree created for a spawn that then failed is a directory and a branch nobody asked for,
// and the browser is the wrong place to unwind that. Here a failed step simply stops, and the
// caller learns which one.
import { runGh } from "./gh.js";
import { runGlab, glabIssueViewArgs, glabTarget } from "./glab.js";
import { normalizeGlabIssueDetail } from "./glab-items.js";
import { forgeFromRepoEntry, projectPath } from "./forge-host.js";
import { createWorktree, issueWorktree } from "./worktrees.js";
import { claimLaunch, worktreeOccupancy, type WorktreeClaim, type WorktreeOccupancy } from "../session/worktree-session-limit.js";
import { createKeySerializer } from "../infra/serialize-per-key.js";
import { isRecord } from "../../common/isRecord.js";
import { worktreeAction, worktreeLimitReason, WORKTREE_LAUNCH_IN_FLIGHT } from "../../common/worktreeSession.js";

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
}

export type StartIssueWorkReason = "issue-not-found" | "worktree-failed" | "worktree-busy";

/** How the work was reached. An issue has ONE worktree, so the second call for it is not a second
 *  piece of work — it is the same one, found again (#1219). */
export type StartIssueWorkOutcome =
  /** A worktree was cut for this issue and a session seeded in it. */
  | "created"
  /** The issue's worktree was already there and empty; the session is new, seed and all. */
  | "reused"
  /** The issue's worktree was already there WITH its session; that session is what opens, so
   *  nothing was spawned and the issue is not typed into anything. */
  | "resumed";

export interface StartIssueWorkResult {
  ok: boolean;
  reason?: StartIssueWorkReason;
  detail?: string;
  outcome?: StartIssueWorkOutcome;
  worktree?: string;
  branch?: string;
  issue?: IssueDetail;
}

const DETAIL_LIMIT = 300;

// The list route deliberately does not fetch bodies — that would be one per issue across every
// configured repo, on a view that only shows titles. The body is wanted exactly once, when
// somebody decides to work on that issue, so it is read here instead.
export async function fetchIssueDetail(repo: string, issue: number): Promise<IssueDetail | null> {
  const forge = forgeFromRepoEntry(repo);
  // The forge itself when it is a GitLab, so the glab call can be addressed at its HOST — a bare
  // project path reaches gitlab.com whatever host the entry named (#1332, see glabTarget).
  const gitlab = forge?.kind === "gitlab" ? forge : null;
  const project = forge ? (projectPath(forge) ?? forge.path) : repo;
  const res = gitlab
    ? await runGlab(glabIssueViewArgs(glabTarget(gitlab), issue))
    : await runGh(["issue", "view", String(issue), "--repo", project, "--json", "number,title,body"]);
  if (!res.ok) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (gitlab) return normalizeGlabIssueDetail(parsed);
    if (!isRecord(parsed) || typeof parsed.number !== "number") return null;
    return {
      number: parsed.number,
      title: typeof parsed.title === "string" ? parsed.title : "",
      // An issue with an empty body is normal — the title alone is then the whole brief.
      body: typeof parsed.body === "string" ? parsed.body : "",
    };
  } catch {
    return null;
  }
}

// What the session finds in its input box: the issue, and where to read the rest of it. The
// number and URL are spelled out because the body alone does not say which issue this is, and the
// agent needs that to comment, to check the discussion, and to write the PR.
//
// NOT submitted — the seed is a draft (see draft-injection.ts), so the user reads it and presses
// Enter. That matters here more than anywhere else in the app: this text was written by whoever
// opened the issue, which is often not the person about to run it.
// What to call the thing and where it lives. Both were hardcoded to GitHub, which for a GitLab
// entry produced `https://github.com/gitlab.com/group/project/issues/N` — a link to nothing, in the
// text the agent is about to read (Codex review). `forge.webUrl` already knows the right answer.
//
// GitLab puts a project's own pages under `/-/`, and serves issues from `/-/issues/<iid>`.
const issueLabel = (repo: string): string => (forgeFromRepoEntry(repo)?.kind === "gitlab" ? "GitLab issue" : "GitHub issue");

function issueUrl(repo: string, number: number): string {
  const forge = forgeFromRepoEntry(repo);
  if (!forge?.webUrl) return `https://github.com/${repo}/issues/${number}`;
  return forge.kind === "gitlab" ? `${forge.webUrl}/-/issues/${number}` : `${forge.webUrl}/issues/${number}`;
}

export function issueSeedPrompt(repo: string, issue: IssueDetail): string {
  const lines = [`${issueLabel(repo)} #${issue.number}: ${issue.title}`, issueUrl(repo, issue.number), ""];
  if (issue.body.trim()) lines.push(issue.body.trim(), "");
  lines.push(`Let's work on this issue. Read it through first and confirm the approach with me before implementing.`);
  return lines.join("\n");
}

export interface StartIssueWorkDeps {
  fetchIssue?: (repo: string, issue: number) => Promise<IssueDetail | null>;
  makeWorktree?: (repoDir: string, task: string, issue: number) => Promise<{ path: string; branch: string } | null>;
  /** The worktree this issue already has here, if any (#1219). */
  findWorktree?: (repoDir: string, issue: number) => Promise<{ path: string; branch: string | null } | null>;
  /** Who is in that worktree, in the one-session-per-worktree sense (#1207). */
  occupancyOf?: (dir: string) => Promise<WorktreeOccupancy>;
  /** Stake the same claim every other launch path stakes on a directory (#1208). */
  claim?: (dir: string) => WorktreeClaim;
  /** Spawn the session in the worktree with the seed waiting in its input box. Returns the id. */
  spawnDraft: (cwd: string, draft: string) => string;
}

type StartedResult = StartIssueWorkResult & { sessionId?: string };

/** What to do about a worktree this issue already has. The three answers are #1207's, reached
 *  through its own vocabulary rather than a second rule: a worktree holds one session, so the
 *  question "may I start here" has already been answered once for every other caller. */
async function reopenIssueWorktree(
  worktree: { path: string; branch: string | null },
  detail: IssueDetail,
  repo: string,
  deps: Pick<StartIssueWorkDeps, "spawnDraft"> & { occupancyOf: (dir: string) => Promise<WorktreeOccupancy>; claim: (dir: string) => WorktreeClaim },
): Promise<StartedResult> {
  // The branch key is spread in only when git named one: a detached worktree has none, and a key
  // present holding `undefined` is not the same as an absent one for a result that crosses the
  // wire (the phone's channel rejects the whole reply over one).
  const found = { worktree: worktree.path, issue: detail, ...(worktree.branch ? { branch: worktree.branch } : {}) };
  // Claimed BEFORE the occupancy read, which is asynchronous (git, then the filesystem): another
  // launch already on its way into this worktree — a grid cell opening, a launcher row — is not
  // visible to that read yet, so both would find it free and both would spawn (#1208, and Codex
  // again on this PR). The same claim every other launch path stakes, so they see each other.
  const claim = deps.claim(worktree.path);
  try {
    if (claim.contended) return { ok: false, reason: "worktree-busy", detail: WORKTREE_LAUNCH_IN_FLIGHT, ...found };
    const { session } = await deps.occupancyOf(worktree.path);
    const action = worktreeAction(session);
    // `busy` is somebody else's terminal, so this stops here and says so — the alternative is two
    // agents in one working tree, which is what the whole rule exists to prevent.
    if (action === "busy" && session) return { ok: false, reason: "worktree-busy", detail: worktreeLimitReason(session), ...found };
    // `resume`: the worktree's session exists and nobody holds it, so THAT is the work — opening
    // it is what the launcher's resume row does. No spawn, and no seed: it has its own history,
    // and the issue text would be typed over whatever the user left in the box.
    if (action === "resume" && session) return { ok: true, outcome: "resumed", sessionId: session.id, ...found };
    return { ok: true, outcome: "reused", sessionId: deps.spawnDraft(worktree.path, issueSeedPrompt(repo, detail)), ...found };
  } finally {
    // Released once the spawn has returned: from then on the pty occupies the worktree on its own
    // account, which is what the next reader sees.
    claim.release();
  }
}

// One start at a time per (clone, issue). The claim above is keyed by DIRECTORY, so it cannot
// cover the case where the worktree does not exist yet: two starts for one issue would each look,
// each find nothing, and each cut a tree — arriving at the same two-worktrees-for-one-issue this
// change exists to prevent, by a different road. Keyed, so unrelated issues still start at once.
const serializePerIssue = createKeySerializer();

/** Read the issue, open the worktree it already has or cut one, and get a session into it. `dir`
 *  must already have been checked against the repo's known clones by the caller — this does not
 *  resolve it. */
export function startIssueWork(repo: string, issue: number, dir: string, deps: StartIssueWorkDeps): Promise<StartedResult> {
  // NUL joins the two halves because a directory path may contain anything else. Written as the
  // ESCAPE: a literal NUL in the source makes the file binary to grep, which then skips it
  // SILENTLY — this module was invisible to several "every place that calls gh" sweeps.
  return serializePerIssue(`${dir}\0${issue}`, () => runIssueWork(repo, issue, dir, deps));
}

async function runIssueWork(repo: string, issue: number, dir: string, deps: StartIssueWorkDeps): Promise<StartedResult> {
  const {
    fetchIssue = fetchIssueDetail,
    makeWorktree = createWorktree,
    findWorktree = issueWorktree,
    occupancyOf = worktreeOccupancy,
    claim = claimLaunch,
    spawnDraft,
  } = deps;

  const detail = await fetchIssue(repo, issue);
  if (!detail) return { ok: false, reason: "issue-not-found", detail: `could not read ${repo}#${issue}`.slice(0, DETAIL_LIMIT) };

  // Looked up BEFORE cutting anything: an issue has one worktree, and a second one differing only
  // by a `-2` suffix is two branches claiming the same issue, with `Fixes #N` in both (#1219).
  const existing = await findWorktree(dir, issue);
  if (existing) return reopenIssueWorktree(existing, detail, repo, { occupancyOf, claim, spawnDraft });

  // The title becomes the branch slug, so the branch reads as what the work IS rather than as a
  // number alone — `issue/1173-start-from-the-issue-row`.
  const worktree = await makeWorktree(dir, detail.title, detail.number);
  if (!worktree) return { ok: false, reason: "worktree-failed", detail: "could not create the worktree (is this a git repo?)" };

  const sessionId = spawnDraft(worktree.path, issueSeedPrompt(repo, detail));
  return { ok: true, outcome: "created", sessionId, worktree: worktree.path, branch: worktree.branch, issue: detail };
}
