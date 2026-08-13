// Aggregate open issues across the user's configured repos via the `gh` CLI, mirroring
// prs.ts. One `gh issue list` per repo in parallel; a failing repo yields a per-repo
// error instead of sinking the view. The pure normalize helper is unit-tested.
import type { IssueItem, RepoIssues } from "../../common/ghItems.js";
import { runGh } from "./gh";
import { normalizeGhItemBase } from "./ghItem";
import { isSupported, repoSupport } from "./forge-support.js";
import { projectPath } from "./forge-host.js";
import { glabIssueListArgs, glabTarget, runGlab } from "./glab.js";
import { normalizeGlabIssue } from "./glab-items.js";

// Per-repo cap. Small on purpose: this is a glanceable digest, and overflow is one
// click away on GitHub (unlike the PR view, which is the primary place PRs are read).
export const ISSUE_LIMIT = 20;

// An issue row carries exactly the shared base fields.
export const normalizeIssue = normalizeGhItemBase;

const GH_FIELDS = "number,title,author,updatedAt,url";

export async function listIssuesAcrossRepos(repos: string[]): Promise<RepoIssues[]> {
  return Promise.all(
    repos.map(async (repo): Promise<RepoIssues> => {
      const support = repoSupport(repo);
      if (!isSupported(support)) return { repo, error: support.error };
      const { forge } = support;
      const gitlab = forge.kind === "gitlab";
      // GitLab puts a project's own pages under `/-/`; GitHub does not.
      const issuesUrl = `${forge.webUrl}${gitlab ? "/-" : ""}/issues`;
      const project = projectPath(forge) ?? forge.path;
      // Fetch one MORE than we display so `truncated` is a real observation
      // (rows > ISSUE_LIMIT), never a false positive at exactly ISSUE_LIMIT.
      const res = gitlab
        ? await runGlab(glabIssueListArgs(glabTarget(forge), ISSUE_LIMIT + 1))
        : await runGh(["issue", "list", "--repo", project, "--state", "open", "--limit", String(ISSUE_LIMIT + 1), "--json", GH_FIELDS]);
      if (!res.ok) return { repo, error: (res.stderr.trim() || `${gitlab ? "glab" : "gh"} issue list failed`).slice(0, 300) };
      try {
        const parsed: unknown = JSON.parse(res.stdout);
        const rows = Array.isArray(parsed) ? parsed : [];
        const truncated = rows.length > ISSUE_LIMIT;
        const issues = rows
          .slice(0, ISSUE_LIMIT)
          .map(gitlab ? normalizeGlabIssue : normalizeIssue)
          .filter((i): i is IssueItem => i !== null);
        return { repo, issues, truncated, url: issuesUrl };
      } catch {
        return { repo, error: `could not parse ${gitlab ? "glab" : "gh"} output` };
      }
    }),
  );
}
