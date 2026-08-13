// Whether work on one repo can start here, decided from the repo -> clone answer alone (#1173).
// Pure, because the three outcomes are the whole behaviour: on the desktop they are a button, a
// menu, or a disabled button that says why (IssueStartButton.vue).
//
// In `common/` because BOTH hosts decide from it: the phone asks the same question over the remote
// command channel (#1184) and must reach the same answer — with one difference it makes itself,
// not one encoded here. It cannot offer the menu (the phone never picks a directory, see
// docs/remote-host-protocol.md), so it refuses `choose` where the desktop opens it.
import type { RepoDirs } from "./repoDirs";
import { GITHUB_HOST, GITLAB_HOST, parseRepoEntry } from "./repoEntry";
import { isGitlabHost, unknownForgeReason } from "./gitlabHosts";

// Where work can be STARTED — the issue is read and a worktree cut. A host that is merely listable
// still refuses, and says which host it is rather than blaming a missing clone (#981). A host the
// user declared as self-hosted GitLab starts work like gitlab.com does (#1332).
const isStartableHost = (host: string, gitlabHosts: readonly string[]): boolean => host === GITHUB_HOST || isGitlabHost(host, gitlabHosts);

/** The hosts named in a refusal, built from the same rule rather than written out beside it — a
 *  hardcoded "github.com only" survived GitLab becoming startable and told users the opposite of
 *  the truth (Codex review). Exported so the phone's refusal says the same thing. */
export const startableHosts = (gitlabHosts: readonly string[]): string => [...new Set([GITHUB_HOST, GITLAB_HOST, ...gitlabHosts])].join(" and ");

export type IssueStartPlan =
  /** No clone of this repo on this machine, so there is nowhere for the work to happen. */
  | { kind: "no-clone" }
  /** The repo is on a forge whose issues can be LISTED but not started from (#981). Distinct from
   *  `no-clone`, which would send the reader off to add a clone that would not help. */
  | { kind: "unsupported-forge"; host: string }
  /** Exactly one answer — either recorded, or the only candidate. One click starts. */
  | { kind: "ready"; dir: string }
  /** Several clones and nothing recorded yet: the user picks, and the pick is remembered. */
  | { kind: "choose"; dirs: RepoDirs["dirs"] };

/** A plan that cannot start work as it stands. Named so a caller that has already narrowed to it
 *  can be given a sentence rather than a nullable one — see the phone's refusal (#1184). */
export type BlockedIssueStartPlan = Exclude<IssueStartPlan, { kind: "ready" }>;

// `repo` is REQUIRED, not optional, even though only one branch reads it: a caller that omitted it
// would get `no-clone` for a GitLab repo, which is the exact wrong answer this parameter was added
// to fix. Making the compiler ask for it is what stops that coming back. `gitlabHosts` is required
// for the same reason — defaulted to empty, a caller that forgot it would refuse the user's own
// self-hosted GitLab and blame the host (#1332).
export function issueStartPlan(entry: RepoDirs | undefined, repo: string, gitlabHosts: readonly string[]): IssueStartPlan {
  // Checked before the clone list, because a GitLab repo has no entry there and would otherwise
  // read as "no clone" — a reason that is not true and points at the wrong fix.
  const parsed = parseRepoEntry(repo);
  if (parsed && !isStartableHost(parsed.host, gitlabHosts)) return { kind: "unsupported-forge", host: parsed.host };
  const dirs = entry?.dirs ?? [];
  if (dirs.length === 0) return { kind: "no-clone" };
  // A recording wins even when the repo has one clone: it is still the same answer, and treating
  // the two cases the same keeps "recorded" from being a state the UI has to distinguish.
  const recorded = entry?.primary;
  if (recorded) return { kind: "ready", dir: recorded };
  const only = dirs.length === 1 ? dirs[0] : undefined;
  if (only) return { kind: "ready", dir: only.path };
  return { kind: "choose", dirs };
}

/** Why the control is disabled, for the row's title text. Null when it is not disabled. */
export function issueStartBlockedReason(plan: IssueStartPlan, repo: string): string | null {
  // The same sentence the row's own error carries: the host is not one this app knows, and the fix
  // is a config line rather than anything about this issue or this clone (#1332).
  if (plan.kind === "unsupported-forge") return unknownForgeReason(plan.host);
  return plan.kind === "no-clone" ? `No local clone of ${repo} — add one to your directory presets to start work here` : null;
}
