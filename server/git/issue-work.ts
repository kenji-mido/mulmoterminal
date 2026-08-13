// Starting work on a GitHub issue (#1173): read the issue, cut a worktree anchored to it, and
// seed a session in that worktree with the issue in its input box.
//
// One operation rather than three calls from the browser, because the steps are not independent:
// a worktree created for a spawn that then failed is a directory and a branch nobody asked for,
// and the browser is the wrong place to unwind that. Here a failed step simply stops, and the
// caller learns which one.
import { runGh } from "./gh.js";
import { createWorktree } from "./worktrees.js";
import { isRecord } from "../../common/isRecord.js";

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
}

export type StartIssueWorkReason = "issue-not-found" | "worktree-failed";

export interface StartIssueWorkResult {
  ok: boolean;
  reason?: StartIssueWorkReason;
  detail?: string;
  worktree?: string;
  branch?: string;
  issue?: IssueDetail;
}

const DETAIL_LIMIT = 300;

// The list route deliberately does not fetch bodies — that would be one per issue across every
// configured repo, on a view that only shows titles. The body is wanted exactly once, when
// somebody decides to work on that issue, so it is read here instead.
export async function fetchIssueDetail(repo: string, issue: number): Promise<IssueDetail | null> {
  const res = await runGh(["issue", "view", String(issue), "--repo", repo, "--json", "number,title,body"]);
  if (!res.ok) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
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
export function issueSeedPrompt(repo: string, issue: IssueDetail): string {
  const lines = [`GitHub issue #${issue.number}: ${issue.title}`, `https://github.com/${repo}/issues/${issue.number}`, ""];
  if (issue.body.trim()) lines.push(issue.body.trim(), "");
  lines.push(`Let's work on this issue. Read it through first and confirm the approach with me before implementing.`);
  return lines.join("\n");
}

export interface StartIssueWorkDeps {
  fetchIssue?: (repo: string, issue: number) => Promise<IssueDetail | null>;
  makeWorktree?: (repoDir: string, task: string, issue: number) => Promise<{ path: string; branch: string } | null>;
  /** Spawn the session in the worktree with the seed waiting in its input box. Returns the id. */
  spawnDraft: (cwd: string, draft: string) => string;
}

/** Read the issue, cut its worktree, and spawn the session. `dir` must already have been checked
 *  against the repo's known clones by the caller — this does not resolve it. */
export async function startIssueWork(
  repo: string,
  issue: number,
  dir: string,
  deps: StartIssueWorkDeps,
): Promise<StartIssueWorkResult & { sessionId?: string }> {
  const { fetchIssue = fetchIssueDetail, makeWorktree = createWorktree, spawnDraft } = deps;

  const detail = await fetchIssue(repo, issue);
  if (!detail) return { ok: false, reason: "issue-not-found", detail: `could not read ${repo}#${issue}`.slice(0, DETAIL_LIMIT) };

  // The title becomes the branch slug, so the branch reads as what the work IS rather than as a
  // number alone — `issue/1173-start-from-the-issue-row`.
  const worktree = await makeWorktree(dir, detail.title, detail.number);
  if (!worktree) return { ok: false, reason: "worktree-failed", detail: "could not create the worktree (is this a git repo?)" };

  const sessionId = spawnDraft(worktree.path, issueSeedPrompt(repo, detail));
  return { ok: true, sessionId, worktree: worktree.path, branch: worktree.branch, issue: detail };
}
