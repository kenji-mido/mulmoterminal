// listIssues / startIssueWork command handlers — beginning work on a GitHub issue FROM THE PHONE
// (#1184). The desktop's half is POST /api/issues/start, and everything below the decision is the
// same code (server/git/issue-work.ts): read the issue, cut its `issue/<N>-<slug>` worktree, spawn
// a session with the issue waiting in the input box.
//
// What differs is how the working directory is chosen, and it is the whole design here. The phone
// never sends a path (docs/remote-host-protocol.md), so it cannot name one and is not asked to:
// the directory is the clone recorded for that repo. When several clones could host the work and
// none has been recorded, the command REFUSES rather than picking one — an agent runs where it is
// started, that cannot be taken back, and the phone has no way to show which tree it landed in.
// The desktop opens a menu for exactly this case, and one pick there settles it for good.
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { getCwdPresets, getGitlabHosts, getPrRepos, getRepoDirs } from "../../../config/config-routes.js";
import { listIssuesAcrossRepos } from "../../../git/issues.js";
import { startIssueWork } from "../../../git/issue-work.js";
import { repoDirsFromPresets } from "../../../git/repo-dirs.js";
import { issueStartPlan, startableHosts, type BlockedIssueStartPlan } from "../../../../common/issueStartPlan.js";
import { isRepoEntry, repoIdentity } from "../../../../common/repoEntry.js";
import { isIssueNumber } from "../../../../common/prPhase.js";
import type { RepoDirs } from "../../../../common/repoDirs.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

// The same slug shape `prRepos` accepts, checked here too because this value is interpolated into
// a `gh --repo` argument and an issue URL.

// GitHub treats `Owner/Repo` and `owner/repo` as one repository, and the two spellings arrive from
// different places: `prRepos` is typed by hand, an entry's own name comes from the remote URL —
// which is also why the host a hand-typed entry may declare is stripped before comparing (#981).
const entryFor = (repos: RepoDirs[], repo: string): RepoDirs | undefined => {
  const wanted = repoIdentity(repo);
  return repos.find((r) => repoIdentity(r.repo) === wanted);
};

/** Why the phone cannot start work on this repo. Written for a person, and it names the DESKTOP
 *  because that is where the missing answer is given — a sentence that only says "no" would leave
 *  the reader with nothing to do about it. */
export function issueStartRefusal(plan: BlockedIssueStartPlan, repo: string): string {
  // Named separately from "no clone" on purpose: adding a clone would not help, so a reader told
  // the wrong reason would go and do something useless (#981).
  // The fix is on the DESKTOP even for a self-hosted GitLab, which is one config line away from
  // working (#1332) — but not a line anyone can write from a phone.
  if (plan.kind === "unsupported-forge")
    return `${repo} is on ${plan.host}. Work can be started on ${startableHosts(getGitlabHosts())} — a self-hosted GitLab has to be added to "gitlabHosts" in the config on the desktop first.`;
  return plan.kind === "no-clone"
    ? `No local clone of ${repo} on this machine. Add one to your directory presets on the desktop to start work here.`
    : `${repo} has several clones on this machine and none is chosen yet. Start one issue from the desktop to choose which clone the work happens in, and this will use it from then on.`;
}

const repoDirsNow = (): Promise<RepoDirs[]> => repoDirsFromPresets(getCwdPresets(), getRepoDirs());

type IssueWorkDeps = Pick<RemoteHostHandlerDeps, "spawnIssueSeed">;

// `canStart` is always present and the sentence only when there is one: the phone's rule is
// "render it if it's there", and an empty string would read as a reason nobody could name.
const listIssuesHandler: CommandHandlers[string] = async () => {
  const [repos, dirs] = await Promise.all([listIssuesAcrossRepos(getPrRepos()), repoDirsNow()]);
  return toJsonObject({
    repos: repos.map((row) => {
      const plan = issueStartPlan(entryFor(dirs, row.repo), row.repo, getGitlabHosts());
      return plan.kind === "ready" ? { ...row, canStart: true } : { ...row, canStart: false, startBlocked: issueStartRefusal(plan, row.repo) };
    }),
  });
};

const startIssueWorkHandler =
  ({ spawnIssueSeed }: IssueWorkDeps): CommandHandlers[string] =>
  async (params: JsonObject) => {
    const repo = typeof params.repo === "string" ? params.repo.trim() : "";
    if (!isRepoEntry(repo)) throw new Error("repo is required, as [host/]owner/repo");
    const { issue } = params;
    if (!isIssueNumber(issue)) throw new Error("issue is required, as a positive issue number");
    // Anything that is not `true` leaves the seed as a draft — the behaviour every caller had
    // before this option existed. A caller that meant to run and spelled it wrong learns so from
    // `ran` below, which reports what happened rather than what was asked for.
    const run = params.run === true;

    const plan = issueStartPlan(entryFor(await repoDirsNow(), repo), repo, getGitlabHosts());
    if (plan.kind !== "ready") throw new Error(issueStartRefusal(plan, repo));

    // OBSERVED, not derived from the outcome: startIssueWork spawns for `created` and `reused` and
    // skips it for `resumed`, and that rule lives there. Reading it off the outcome here would be
    // a second copy of it, right up until a fourth outcome is added.
    let seeded = false;
    // Carried on as configured, host and all: the layer below reads the host to decide which forge
    // to ask, and strips it only when building the CLI argument (#1257).
    const result = await startIssueWork(repo, issue, plan.dir, {
      spawnDraft: (cwd, seed) => {
        seeded = true;
        return spawnIssueSeed(cwd, seed, run);
      },
    });
    // A failed step stops here with the reason it failed — the same detail the desktop route turns
    // into a status code, which on this channel is simply the sentence the phone shows.
    if (!result.ok || !result.sessionId) throw new Error(result.detail ?? `could not start work on ${repo}#${issue}`);
    return toJsonObject({
      started: true,
      sessionId: result.sessionId,
      branch: result.branch ?? "",
      // Which of the three things happened (#1219). `resumed` is the one the phone must not
      // describe as a fresh start: that session was already working on this issue, and the issue
      // text is NOT waiting in its box.
      outcome: result.outcome ?? "created",
      // Whether this session was started to SUBMIT its seed (#1253), so the phone says "started"
      // rather than "it's in the input box, press Enter yourself" — which on a phone is not
      // something the reader can do. Not a landed keystroke: the typing happens after this reply,
      // once the TUI's input box has painted.
      ran: run && seeded,
      // The title, so the phone can confirm WHICH issue it just started without a second call. The
      // body is deliberately not echoed: it is already in the session's input box, and it is the
      // one field here with no upper bound.
      issue: { number: issue, title: result.issue?.title ?? "" },
    });
  };

export const createIssueWorkHandlers = (deps: IssueWorkDeps): CommandHandlers => ({
  listIssues: listIssuesHandler,
  startIssueWork: startIssueWorkHandler(deps),
});
