// What the issue row's start control can do — three outcomes, each a different thing for the
// user to see, so each is pinned rather than left to the component.
import { describe, it, expect } from "vitest";
import { issueStartPlan, issueStartBlockedReason, startableHosts } from "../../common/issueStartPlan";
import type { RepoDirs } from "../../common/repoDirs";

// No self-hosted GitLab declared — the state every case below is in unless it says otherwise.
const NONE: string[] = [];

const entry = (paths: string[], primary: string | null = null): RepoDirs => ({
  repo: "acme/web",
  dirs: paths.map((path) => ({ path, label: path.split("/").pop() ?? path, orderPriority: null })),
  primary,
});

describe("issueStartPlan", () => {
  // A repo the user watches but has never cloned. There is nowhere for the work to happen, and
  // the control must say so rather than fail on click.
  it.each([
    ["a repo absent from the answer", undefined],
    ["a repo with an empty candidate list", entry([])],
  ])("is no-clone for %s", (_case, value) => {
    expect(issueStartPlan(value, "acme/web", NONE)).toEqual({ kind: "no-clone" });
  });

  it("is ready with the only candidate when the repo has one clone", () => {
    expect(issueStartPlan(entry(["/w/web"]), "acme/web", NONE)).toEqual({ kind: "ready", dir: "/w/web" });
  });

  it("is ready with the recorded choice when there are several", () => {
    expect(issueStartPlan(entry(["/w/web", "/w/web2"], "/w/web2"), "acme/web", NONE)).toEqual({ kind: "ready", dir: "/w/web2" });
  });

  // Treating a recorded single clone the same as an unrecorded one keeps "recorded" from being a
  // state the component has to tell apart — it is the same answer either way.
  it("is ready when a single clone is also the recorded one", () => {
    expect(issueStartPlan(entry(["/w/web"], "/w/web"), "acme/web", NONE)).toEqual({ kind: "ready", dir: "/w/web" });
  });

  it("asks which clone when there are several and nothing is recorded", () => {
    const plan = issueStartPlan(entry(["/w/web", "/w/web2", "/w/web3"]), "acme/web", NONE);
    expect(plan.kind).toBe("choose");
    expect(plan.kind === "choose" && plan.dirs.map((d) => d.path)).toEqual(["/w/web", "/w/web2", "/w/web3"]);
  });
});

describe("issueStartBlockedReason", () => {
  it("names the repo, and says what to do about it", () => {
    const reason = issueStartBlockedReason({ kind: "no-clone" }, "acme/web");
    expect(reason).toContain("acme/web");
    expect(reason).toContain("directory presets");
  });

  it.each([
    ["ready", { kind: "ready" as const, dir: "/w/web" }],
    ["choose", { kind: "choose" as const, dirs: entry(["/w/a", "/w/b"]).dirs }],
  ])("is null for %s", (_case, plan) => {
    expect(issueStartBlockedReason(plan, "acme/web")).toBeNull();
  });
});

// A GitLab repo has no entry in the clone answer, so before this it planned as `no-clone` and the
// row said "add a local clone" — a fix that would not have helped, because starting work is
// GitHub-only whatever clones exist (Codex review, #981).
describe("a repo on a forge that can be listed but not started from", () => {
  it("names the forge instead of blaming a missing clone", () => {
    const plan = issueStartPlan(undefined, "codeberg.org/owner/repo", NONE);
    expect(plan).toEqual({ kind: "unsupported-forge", host: "codeberg.org" });
    expect(issueStartBlockedReason(plan, "codeberg.org/owner/repo")).toContain("codeberg.org");
    expect(issueStartBlockedReason(plan, "codeberg.org/owner/repo")).not.toContain("No local clone");
  });

  // Checked before the clone list, so the answer does not depend on whether a clone is present.
  it("holds even when a clone exists", () => {
    const entry = { repo: "codeberg.org/owner/repo", dirs: [{ path: "/w/p", label: "p", orderPriority: null }], primary: "/w/p" };
    expect(issueStartPlan(entry, "codeberg.org/owner/repo", NONE).kind).toBe("unsupported-forge");
  });

  // GitLab moved from listable to startable in #1257: its issue is read with `glab` and the
  // worktree is cut from its clone like any other, so it goes on to the clone question.
  it("lets a GitLab repo through to the clone question", () => {
    expect(issueStartPlan(undefined, "gitlab.com/group/project", NONE)).toEqual({ kind: "no-clone" });
  });

  it.each([["acme/web"], ["github.com/acme/web"]])("leaves a GitHub entry (%s) alone", (repo) => {
    expect(issueStartPlan(undefined, repo, NONE)).toEqual({ kind: "no-clone" });
  });
});

// A host the user declared in `gitlabHosts` is a GitLab, so work starts on it exactly as it does on
// gitlab.com (#1332). Without the declaration the same entry is a host nobody knows — which is the
// state #1332 was filed from, and the reason the refusal has to say what to add.
describe("a self-hosted GitLab", () => {
  const DECLARED = ["gitlab.hogefuga.com"];
  const REPO = "gitlab.hogefuga.com/group/project";

  it("goes on to the clone question once declared", () => {
    expect(issueStartPlan(undefined, REPO, DECLARED)).toEqual({ kind: "no-clone" });
  });

  it("starts in its clone like any other repo", () => {
    const clones: RepoDirs = { repo: REPO, dirs: [{ path: "/w/p", label: "p", orderPriority: null }], primary: null };
    expect(issueStartPlan(clones, REPO, DECLARED)).toEqual({ kind: "ready", dir: "/w/p" });
  });

  it("is an unknown host until it is declared, and the refusal says what to add", () => {
    const plan = issueStartPlan(undefined, REPO, NONE);
    expect(plan).toEqual({ kind: "unsupported-forge", host: "gitlab.hogefuga.com" });
    expect(issueStartBlockedReason(plan, REPO)).toContain("gitlabHosts");
  });

  // Declaring github.com must not hand GitHub to `glab`: it is the one wrong entry that would be
  // easy to write and expensive to debug, so the rule refuses it wherever it is asked.
  it("cannot be used to turn github.com into a GitLab", () => {
    expect(issueStartPlan(undefined, "github.com/acme/web", ["github.com"])).toEqual({ kind: "no-clone" });
  });
});

// `github.com/owner/repo` became storable in #981 step 2a, and `/api/repo-dirs` keys by the name
// it reads off a clone's remote — `owner/repo`, with no host. Comparing the raw entry against
// those keys found nothing and disabled Start on a repo that HAS a clone (Codex review).
describe("a GitHub entry that spells its host out", () => {
  const clones: RepoDirs = { repo: "acme/web", dirs: [{ path: "/w/web", label: "web", orderPriority: null }], primary: null };

  it("finds the clone recorded under the hostless name", () => {
    expect(issueStartPlan(clones, "github.com/acme/web", NONE)).toEqual({ kind: "ready", dir: "/w/web" });
  });

  it("is still a GitHub entry, not an unsupported forge", () => {
    expect(issueStartPlan(undefined, "github.com/acme/web", NONE)).toEqual({ kind: "no-clone" });
  });
});

// The refusal names the hosts work can start on from the same rule the planner applies, not a
// sentence written beside it: a hardcoded "github.com only" survived GitLab becoming startable and
// told users the opposite of what the code did (Codex review, #1257).
describe("what the refusal says work is supported on", () => {
  it("names every startable host, so the sentence cannot go stale", () => {
    const reason = issueStartBlockedReason(issueStartPlan(undefined, "codeberg.org/owner/repo", NONE), "codeberg.org/owner/repo");
    expect(reason).toContain("github.com");
    expect(reason).toContain("gitlab.com");
  });

  it("does not claim only one host is supported", () => {
    expect(issueStartBlockedReason(issueStartPlan(undefined, "codeberg.org/owner/repo", NONE), "codeberg.org/owner/repo")).not.toContain("only");
  });

  // The phone's refusal lists them (#1184), and a declared host IS one work can start on — leaving
  // it out would tell a self-hosted user their own host is not supported while it is working.
  it("includes a declared host in the list the phone shows", () => {
    expect(startableHosts(["gitlab.hogefuga.com"])).toContain("gitlab.hogefuga.com");
    expect(startableHosts(NONE)).toBe("github.com and gitlab.com");
  });
});
