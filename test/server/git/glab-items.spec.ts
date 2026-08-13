// @vitest-environment node
// GitLab's JSON turned into the rows this app already renders. The two fixtures below were
// CAPTURED from gitlab.com (gitlab-org/cli, 2026-08-01) rather than written by hand, so a field
// GitLab renames breaks this instead of quietly emptying a row.
import { describe, it, expect } from "vitest";
import {
  firstGlabMr,
  glabFirstMrUrl,
  glabIssueIsOpen,
  glabMrBody,
  glabMrPhase,
  glabNotes,
  normalizeGlabIssue,
  normalizeGlabIssueDetail,
  normalizeGlabMr,
} from "../../../server/git/glab-items.js";
import {
  glabIssueCloseArgs,
  glabIssueListArgs,
  glabMrCreateArgs,
  glabMrForBranchArgs,
  glabMrUpdateBodyArgs,
  glabMrViewArgs,
  glabIssueNoteArgs,
  glabIssueNoteEditArgs,
  glabIssueNotesArgs,
  glabIssueViewArgs,
  glabMrListArgs,
  glabTarget,
  type GlabTarget,
} from "../../../server/git/glab.js";
import { forgeFromRepoEntry } from "../../../server/git/forge-host.js";

// Built through the real chain rather than as an object literal: what `--repo` and `api` are given
// is decided by forge-host + glabTarget together, and a hand-made target would test neither.
const targetFor = (entry: string): GlabTarget => {
  const forge = forgeFromRepoEntry(entry);
  if (!forge) throw new Error(`not a repository entry: ${entry}`);
  return glabTarget(forge);
};

const REAL_MR = {
  iid: 3675,
  title: "fix(ci): highlight the focused modal button",
  updated_at: "2026-08-01T11:15:58.201Z",
  web_url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3675",
  draft: false,
  detailed_merge_status: "not_approved",
  state: "opened",
  author: { username: "samuelfirst1" },
};

const REAL_ISSUE = {
  iid: 8484,
  title: 'glab_1.111.0_Windows_x86_64_installer.exe: uses "Program Files (x86)" install prefix.',
  updated_at: "2026-08-01T16:10:24.082Z",
  web_url: "https://gitlab.com/gitlab-org/cli/-/work_items/8484",
  state: "opened",
  author: { username: "St0fF-NPL-ToM" },
};

describe("normalizeGlabIssue", () => {
  it("maps a real GitLab issue onto the shared row", () => {
    expect(normalizeGlabIssue(REAL_ISSUE)).toEqual({
      number: 8484,
      title: 'glab_1.111.0_Windows_x86_64_installer.exe: uses "Program Files (x86)" install prefix.',
      author: "St0fF-NPL-ToM",
      updatedAt: "2026-08-01T16:10:24.082Z",
      // Taken as given: GitLab is moving issues to `/-/work_items/`, and it already answers with
      // that path. A URL composed here would point at the older one.
      url: "https://gitlab.com/gitlab-org/cli/-/work_items/8484",
    });
  });

  // `id` is unique across the whole instance; `iid` is the number the UI and the URL show. Reading
  // the wrong one produces rows whose numbers match nothing a user can look up.
  it("numbers the row from iid, not id", () => {
    expect(normalizeGlabIssue({ ...REAL_ISSUE, id: 999999 })?.number).toBe(8484);
  });

  it.each([
    ["a non-object", "nope"],
    ["no iid", { ...REAL_ISSUE, iid: undefined }],
    ["a non-integer iid", { ...REAL_ISSUE, iid: 1.5 }],
    ["no web_url", { ...REAL_ISSUE, web_url: "" }],
  ])("drops a row with %s", (_case, raw) => {
    expect(normalizeGlabIssue(raw)).toBeNull();
  });

  it("survives a missing author rather than dropping the row", () => {
    expect(normalizeGlabIssue({ ...REAL_ISSUE, author: null })?.author).toBe("");
  });
});

describe("normalizeGlabMr", () => {
  it("maps a real merge request onto the shared row", () => {
    expect(normalizeGlabMr(REAL_MR)).toEqual({
      number: 3675,
      title: "fix(ci): highlight the focused modal button",
      author: "samuelfirst1",
      updatedAt: "2026-08-01T11:15:58.201Z",
      url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3675",
      isDraft: false,
      review: "REVIEW_REQUIRED",
      ci: "none",
    });
  });

  // Only the statuses that genuinely mean the same thing are mapped. The rest leave `review` empty
  // rather than inventing a GitHub verdict for a GitLab state — `discussions_not_resolved` is not
  // "changes requested", and `mergeable` is not "approved" on a project that requires no approvals.
  it.each([
    ["requested_changes", "CHANGES_REQUESTED"],
    ["not_approved", "REVIEW_REQUIRED"],
    ["mergeable", null],
    ["discussions_not_resolved", null],
    ["merge_request_blocked", null],
    ["unchecked", null],
    ["conflict", null],
    ["draft_status", null],
  ])("maps detailed_merge_status %s to review %s", (status, review) => {
    expect(normalizeGlabMr({ ...REAL_MR, detailed_merge_status: status })?.review).toBe(review);
  });

  // The list endpoint carries no pipeline at all, and `CiState` is GitHub's vocabulary, left
  // untouched — so a GitLab row says no more than a GitHub one can. `ci_must_pass` is the single
  // status that names CI as the blocker; everything else falls back to the same `none` a GitHub
  // row with no checks carries.
  it.each([
    ["ci_must_pass", "pending"],
    ["mergeable", "none"],
    ["not_approved", "none"],
    ["unchecked", "none"],
  ])("reports CI for %s as %s", (status, ci) => {
    expect(normalizeGlabMr({ ...REAL_MR, detailed_merge_status: status })?.ci).toBe(ci);
  });

  // `draft` is its own boolean, so the title prefix never has to be parsed.
  it.each([
    [true, true],
    [false, false],
  ])("reads draft: %s from the field, not the title", (draft, expected) => {
    expect(normalizeGlabMr({ ...REAL_MR, draft, title: "Draft: something" })?.isDraft).toBe(expected);
  });

  it("drops a merge request it cannot number", () => {
    expect(normalizeGlabMr({ ...REAL_MR, iid: undefined })).toBeNull();
  });
});

// The argv itself, because these flags do not mean what a reader of `gh` would assume and a wrong
// one produces a command that RUNS and returns the wrong thing (verified against glab 1.111.0).
describe("glab list arguments", () => {
  it("asks mr list for json with -F", () => {
    expect(glabMrListArgs(targetFor("gitlab.com/group/project"), 21)).toEqual([
      "mr",
      "list",
      "--repo",
      "https://gitlab.com/group/project",
      "--per-page",
      "21",
      "-F",
      "json",
    ]);
  });

  // `-F` on `issue list` is `--output-format` (details|ids|urls), NOT the output format — that is
  // `-O`. The same short flag, a different meaning, one subcommand apart.
  //
  // No state flag: `--opened` exists but is deprecated, and running it prints a warning saying the
  // open list is the default. Passing it would add noise now and break later.
  it("asks issue list for json with -O, and passes no state flag", () => {
    expect(glabIssueListArgs(targetFor("gitlab.com/group/project"), 21)).toEqual([
      "issue",
      "list",
      "--repo",
      "https://gitlab.com/group/project",
      "--per-page",
      "21",
      "-O",
      "json",
    ]);
  });
});

// One issue's detail, which is what the seeded session shows. Captured from gitlab.com.
describe("normalizeGlabIssueDetail", () => {
  const REAL_DETAIL = {
    id: 196437163,
    iid: 1,
    title: "mulmoterminal からの表示確認用",
    description: "#981 段階4a の実機確認。消して構いません。",
    state: "opened",
    web_url: "https://gitlab.com/isamu1/node-test/-/work_items/1",
  };

  it("maps a real issue, taking the body from `description`", () => {
    expect(normalizeGlabIssueDetail(REAL_DETAIL)).toEqual({
      number: 1,
      title: "mulmoterminal からの表示確認用",
      body: "#981 段階4a の実機確認。消して構いません。",
    });
  });

  // `id` is unique across the instance; `iid` is what the URL and the UI show.
  it("numbers from iid, not id", () => {
    expect(normalizeGlabIssueDetail(REAL_DETAIL)?.number).toBe(1);
  });

  // An issue with no description is ordinary — the title is then the whole brief, as on GitHub.
  it("gives an empty body rather than dropping an issue with no description", () => {
    expect(normalizeGlabIssueDetail({ ...REAL_DETAIL, description: null })).toMatchObject({ number: 1, body: "" });
  });

  it.each([
    ["a non-object", "nope"],
    ["no iid", { title: "x" }],
  ])("returns null for %s", (_case, raw) => {
    expect(normalizeGlabIssueDetail(raw)).toBeNull();
  });
});

describe("glabIssueViewArgs", () => {
  // `-F`, like `mr list` — and UNLIKE `issue list`, which takes `-O` and gives `-F` another
  // meaning. Three subcommands, three answers; `-O` here is rejected outright by glab.
  it("asks for json with -F", () => {
    expect(glabIssueViewArgs(targetFor("gitlab.com/group/project"), 7)).toEqual([
      "issue",
      "view",
      "7",
      "--repo",
      "https://gitlab.com/group/project",
      "-F",
      "json",
    ]);
  });
});

// Existing comments, for the duplicate check that keeps a work comment from being written twice.
// These shapes were read back from gitlab.com after posting a real note.
describe("glabNotes", () => {
  const userNote = { id: 1, body: "started work in mulmoterminal4", system: false, created_at: "2026-08-04T14:20:31.000Z" };
  // GitLab writes its own notes for closing, labelling, editing the description. They are not
  // comments anyone left — counting them would let a closed-once issue read as already commented.
  const systemNote = { id: 2, body: "closed", system: true };

  it("keeps what a person wrote and drops what GitLab wrote", () => {
    expect(glabNotes([userNote, systemNote])).toEqual([{ id: "1", body: "started work in mulmoterminal4", createdAt: "2026-08-04T14:20:31.000Z" }]);
  });

  it("treats a note with no system flag as a person's", () => {
    expect(glabNotes([{ id: 3, body: "no flag here" }])).toEqual([{ id: "3", body: "no flag here", createdAt: null }]);
  });

  it.each([
    ["not an array", { notes: [] }],
    ["null", null],
  ])("is empty for %s", (_case, raw) => {
    expect(glabNotes(raw)).toEqual([]);
  });

  it("survives a note with no body", () => {
    expect(glabNotes([{ id: 4, system: false }])).toEqual([{ id: "4", body: "", createdAt: null }]);
  });

  // The id is what the PUT that edits a note is addressed to. A note that arrives without a usable
  // one can still be read — it just cannot be updated, and the caller has to be able to see that.
  it("reports a note with no usable id rather than inventing one", () => {
    expect(glabNotes([{ body: "who wrote this", system: false }])).toEqual([{ id: null, body: "who wrote this", createdAt: null }]);
  });
});

describe("glabIssueIsOpen", () => {
  // GitLab spells it `opened`, lowercase — GitHub answers `OPEN`. Reading the wrong one would make
  // every issue look closed, and the merged comment would never close anything.
  it.each([
    ["opened", true],
    ["closed", false],
    ["OPEN", false],
  ])("reads state %s as open=%s", (state, open) => {
    expect(glabIssueIsOpen({ state })).toBe(open);
  });

  it("is false for something that is not an issue", () => {
    expect(glabIssueIsOpen("nope")).toBe(false);
  });
});

describe("glab issue write arguments", () => {
  // `note`, not `comment`. A reader who pattern-matched from `gh` would write the wrong verb, and
  // glab would reject it outright rather than doing something subtly different.
  it("comments with `note` and -m", () => {
    expect(glabIssueNoteArgs(targetFor("gitlab.com/group/project"), 7, "hello")).toEqual([
      "issue",
      "note",
      "7",
      "--repo",
      "https://gitlab.com/group/project",
      "-m",
      "hello",
    ]);
  });

  it("closes with the issue id", () => {
    expect(glabIssueCloseArgs(targetFor("gitlab.com/group/project"), 7)).toEqual(["issue", "close", "7", "--repo", "https://gitlab.com/group/project"]);
  });

  // The notes endpoint, because `issue view -F json` carries no comments. The project path is
  // percent-encoded: GitLab's REST API takes it as ONE path segment, so a group's slashes must not
  // read as segment separators.
  it("reads notes from the REST endpoint, with the project encoded", () => {
    expect(glabIssueNotesArgs(targetFor("gitlab.com/group/sub/project"), 7)).toEqual([
      "api",
      "--hostname",
      "gitlab.com",
      "projects/group%2Fsub%2Fproject/issues/7/notes",
      "--paginate",
    ]);
  });

  // Not a nicety. A page holds 20 notes, newest first, so one page drops the OLDEST — and the
  // work comment is written when work STARTS, which is the end that falls off. Without this the
  // duplicate check misses it and comments again (Codex review).
  it("always paginates, so an old comment on a long thread is still found", () => {
    expect(glabIssueNotesArgs(targetFor("gitlab.com/group/project"), 1)).toContain("--paginate");
  });

  // `glab issue` has a subcommand to ADD a note and none to change one, so editing goes through
  // the REST endpoint the reader above already talks to. `--method` is explicit because passing a
  // field otherwise switches glab to POST, and `--raw-field` rather than `--field` because the
  // typed one converts `@file` and the bare words true/false/null — a comment body is neither.
  it("edits a note through the REST endpoint, with the project encoded", () => {
    expect(glabIssueNoteEditArgs(targetFor("gitlab.com/group/sub/project"), 7, "42", "updated")).toEqual([
      "api",
      "--hostname",
      "gitlab.com",
      "--method",
      "PUT",
      "projects/group%2Fsub%2Fproject/issues/7/notes/42",
      "--raw-field",
      "body=updated",
    ]);
  });

  // A self-hosted host must be addressed by --hostname, or the request goes to gitlab.com and the
  // 404 that comes back is another server's answer (#1332).
  it("edits on the host the entry names", () => {
    expect(glabIssueNoteEditArgs(targetFor("gitlab.example.com/group/project"), 1, "2", "x")).toContain("gitlab.example.com");
  });
});

// The merge-request half of the ⧉ Open PR path. Shapes read back from a real MR on gitlab.com.
describe("glabMrBody", () => {
  it("takes the body from `description`", () => {
    expect(glabMrBody({ iid: 2, description: "Fixes #1\n\nwork in glreal" })).toBe("Fixes #1\n\nwork in glreal");
  });

  // A merge request with no description is ordinary — `--fill` leaves it empty when the commit has
  // no body. Reading it as a failure would skip appending the footer.
  it.each([
    ["an empty description", { iid: 2, description: "" }],
    ["no description at all", { iid: 2 }],
    ["something that is not an MR", "nope"],
  ])("is the empty string for %s", (_case, raw) => {
    expect(glabMrBody(raw)).toBe("");
  });
});

describe("glabFirstMrUrl", () => {
  it("takes the web_url of the first merge request", () => {
    expect(glabFirstMrUrl([{ iid: 2, web_url: "https://gitlab.com/o/p/-/merge_requests/2" }])).toBe("https://gitlab.com/o/p/-/merge_requests/2");
  });

  // An empty list is the ordinary "no merge request for this branch yet" answer, which is what
  // sends the caller on to the compare-page fallback rather than to an error.
  it.each([
    ["an empty list", []],
    ["not a list", { merge_requests: [] }],
    ["a row with no web_url", [{ iid: 2 }]],
  ])("is null for %s", (_case, raw) => {
    expect(glabFirstMrUrl(raw)).toBeNull();
  });
});

describe("glab merge-request arguments", () => {
  // No `--repo` anywhere: glab infers the project from the working directory, the same way `gh`
  // does — verified by running `glab mr list` in a directory holding nothing but a remote.
  it.each([
    ["create", glabMrCreateArgs("master", "issue/1-x")],
    ["forBranch", glabMrForBranchArgs("issue/1-x")],
    ["view", glabMrViewArgs("https://gitlab.com/o/p/-/merge_requests/2")],
    ["update", glabMrUpdateBodyArgs("https://gitlab.com/o/p/-/merge_requests/2", "body")],
  ])("%s passes no --repo", (_name, args) => {
    expect(args).not.toContain("--repo");
  });

  it("creates with the source and target branches named", () => {
    expect(glabMrCreateArgs("master", "issue/1-x")).toEqual(["mr", "create", "--fill", "--source-branch", "issue/1-x", "--target-branch", "master", "--yes"]);
  });

  // A URL is accepted wherever an iid is, which is what lets the body helpers keep taking the URL
  // they were handed rather than parsing an iid out of it.
  it("views and updates by whatever identifier it was given", () => {
    const url = "https://gitlab.com/o/p/-/merge_requests/2";
    expect(glabMrViewArgs(url)).toEqual(["mr", "view", url, "-F", "json"]);
    expect(glabMrUpdateBodyArgs(url, "b")).toEqual(["mr", "update", url, "--description", "b"]);
  });
});

// A merge request's phase. GitLab collapses into `detailed_merge_status` what GitHub splits three
// ways, and it is INDEPENDENT of the pipeline — observed on real merge requests, `success` with
// `not_approved` and `failed` with `not_approved` both occur.
describe("glabMrPhase", () => {
  const mr = (over: Record<string, unknown> = {}) => ({ state: "opened", draft: false, detailed_merge_status: "mergeable", ...over });

  it("is ready only when GitLab agrees it could merge", () => {
    expect(glabMrPhase(mr())).toEqual({ phase: "ready", blockedReason: null });
  });

  it.each([
    ["merged", "merged"],
    ["closed", "closed"],
  ])("reads the %s state before anything else", (state, phase) => {
    // Even with a blocker recorded: a merged request is not "waiting on approvals".
    expect(glabMrPhase(mr({ state, detailed_merge_status: "not_approved" }))).toEqual({ phase, blockedReason: null });
  });

  // The reason the field exists: three GitLab statuses have no home in `PrPhase`. Calling them
  // `ready` would name something unmergeable ready; the phase says "someone must act" and the
  // reason says what.
  it.each([
    ["not_approved", "waiting on approvals"],
    ["discussions_not_resolved", "unresolved discussions"],
    ["merge_request_blocked", "blocked by another merge request"],
    ["conflict", "conflicts with the target branch"],
  ])("keeps %s out of `ready` and explains it", (status, reason) => {
    expect(glabMrPhase(mr({ detailed_merge_status: status }))).toEqual({ phase: "changes-requested", blockedReason: reason });
  });

  // `ready` ONLY when GitLab says `mergeable`. A status we have no phrase for is still a status
  // GitLab is reporting INSTEAD of mergeable, so calling it ready is a green pill on a merge
  // request that cannot merge — the one direction of error that matters (Codex review).
  // Two things at once, and an earlier revision of this PR got each of them wrong in turn.
  // NOT ready: GitLab named something other than `mergeable`, so a green pill would be false.
  // NOT explained either: `detailed_merge_status` is GitLab's internal vocabulary, and putting an
  // unrecognised one in a tooltip shows a reader a raw backend identifier (Codex review, twice).
  it("neither calls an unrecognised status ready nor prints it", () => {
    expect(glabMrPhase(mr({ detailed_merge_status: "some_new_status" }))).toEqual({ phase: "changes-requested", blockedReason: null });
  });

  // The case Codex named. `ci_must_pass` means CI is what is holding the merge — and a LIST row
  // never carries `head_pipeline`, which is exactly the fallback path taken when `mr view` fails.
  it("reads ci_must_pass as CI running even with no pipeline field at all", () => {
    expect(glabMrPhase({ state: "opened", draft: false, detailed_merge_status: "ci_must_pass" })).toEqual({
      phase: "ci-running",
      blockedReason: "waiting on CI",
    });
  });

  // Draft is the author's own "not yet", which outranks whatever the project is waiting on — the
  // same order `derivePrPhase` uses for GitHub.
  it("reports a draft as draft, while still carrying the reason", () => {
    expect(glabMrPhase(mr({ draft: true, detailed_merge_status: "not_approved" }))).toEqual({ phase: "draft", blockedReason: "waiting on approvals" });
  });

  it.each([
    ["failed", "ci-failing"],
    ["canceled", "ci-failing"],
    ["running", "ci-running"],
    ["pending", "ci-running"],
  ])("reads a %s pipeline as %s", (status, phase) => {
    expect(glabMrPhase(mr({ head_pipeline: { status } })).phase).toBe(phase);
  });

  // The pipeline is independent of the merge status, so a green pipeline does NOT make an
  // unapproved request ready.
  it("does not let a green pipeline override an outstanding approval", () => {
    expect(glabMrPhase(mr({ head_pipeline: { status: "success" }, detailed_merge_status: "not_approved" }))).toEqual({
      phase: "changes-requested",
      blockedReason: "waiting on approvals",
    });
  });

  it("is `none` for something that is not a merge request", () => {
    expect(glabMrPhase("nope")).toEqual({ phase: "none", blockedReason: null });
  });
});

describe("firstGlabMr", () => {
  it("takes the iid, url and title of the first row", () => {
    const row = { iid: 3, web_url: "https://gitlab.com/o/p/-/merge_requests/3", title: "a change" };
    expect(firstGlabMr([row])).toMatchObject({ iid: 3, url: "https://gitlab.com/o/p/-/merge_requests/3", title: "a change" });
  });

  // The row itself rides along so a failed detail read can still answer from what the list knew.
  it("carries the row so a failed detail read can fall back to it", () => {
    const row = { iid: 3, web_url: "u", title: "t", detailed_merge_status: "not_approved" };
    expect(glabMrPhase(firstGlabMr([row])?.raw).blockedReason).toBe("waiting on approvals");
  });

  it.each([
    ["an empty list", []],
    ["not a list", {}],
    ["a row with no iid", [{ web_url: "u" }]],
  ])("is null for %s", (_case, raw) => {
    expect(firstGlabMr(raw)).toBeNull();
  });
});
