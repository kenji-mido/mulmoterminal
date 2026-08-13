// @vitest-environment node
// Recording a milestone on an issue, exactly once, from a caller that asks on every poll of every
// open tab (#979 Phase 2, #1369). Everything here is about that "exactly once": when the thread
// already answers the question, what the process memo saves, and — since there is now ONE comment
// per clone that gets edited — that a later milestone edits it rather than posting a second one.
//
// The body's own shape is pinned in test/common/workComment.spec.ts; this file is about the calls.
import { describe, it, expect, beforeEach } from "vitest";
import { ensureWorkComment, clearWorkCommentMemo } from "../../../server/git/work-comment";
import { renderWorkComment, workCommentMarker, type WorkEvent } from "../../../common/workComment";

const NOW = () => new Date("2026-08-04T15:05:00Z");
const STARTED: WorkEvent = { kind: "start", at: "2026-08-04 14:20 UTC", pr: null };

const COMMENT_URL = "https://github.com/o/r/issues/966#issuecomment-5170970759";

interface FakeComment {
  body: string;
  url?: string;
  createdAt?: string;
}

const issueView = (comments: (string | FakeComment)[], state = "OPEN") =>
  JSON.stringify({
    state,
    comments: comments.map((c) =>
      typeof c === "string" ? { body: c, url: COMMENT_URL, createdAt: "2026-08-04T14:20:31Z" } : { url: COMMENT_URL, createdAt: "2026-08-04T14:20:31Z", ...c },
    ),
  });

// A `gh` stand-in that records what it was asked to do. `stderr` is what a refusing call prints —
// the only thing the cause is read from, so a case about causes sets it to real `gh` output.
function fakeGh(view: string, opts: { commentOk?: boolean; closeOk?: boolean; viewOk?: boolean; editOk?: boolean; stderr?: string } = {}) {
  const calls: string[][] = [];
  const err = opts.stderr ?? "";
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return { ok: opts.editOk ?? true, stdout: "", stderr: err };
    if (args[1] === "view") return { ok: opts.viewOk ?? true, stdout: view, stderr: err };
    if (args[1] === "comment") return { ok: opts.commentOk ?? true, stdout: "", stderr: err };
    return { ok: opts.closeOk ?? true, stdout: "", stderr: err };
  };
  const did = (verb: string) => calls.filter((c) => (verb === "api" ? c[0] === "api" : c[1] === verb)).length;
  const argsFor = (verb: string) => calls.find((c) => (verb === "api" ? c[0] === "api" : c[1] === verb));
  return { run, calls, did, argsFor };
}

beforeEach(() => clearWorkCommentMemo());

describe("ensureWorkComment", () => {
  it("writes the comment when the thread has none", async () => {
    const gh = fakeGh(issueView(["unrelated"]));
    const result = await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run, now: NOW });
    expect(result.posted).toBe(true);
    expect(gh.did("comment")).toBe(1);
    const body = gh.argsFor("comment")?.join(" ") ?? "";
    expect(body).toContain("mulmoterminal:work:start");
    expect(body).toContain("- started — 2026-08-04 15:05 UTC");
  });

  // The property the whole module exists for.
  it("writes once however many times it is asked", async () => {
    const gh = fakeGh(issueView([]));
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(gh.did("comment")).toBe(1);
    expect(gh.did("view")).toBe(1); // the memo also spares gh the repeat lookups
  });

  // Two tabs poll at the same moment: without a shared in-flight run both read the thread before
  // either writes, both see nothing, and both comment (found by Codex review). The memo alone
  // cannot help — it is only set after a write lands.
  it("writes once when two callers arrive together", async () => {
    let releaseView = () => {};
    const held = new Promise<void>((resolve) => {
      releaseView = resolve;
    });
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[1] === "view") {
        await held; // both callers are now inside, before either has written
        return { ok: true, stdout: issueView([]), stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    };

    const first = ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: run });
    const second = ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: run });
    releaseView();
    const [a, b] = await Promise.all([first, second]);

    expect(calls.filter((c) => c[1] === "comment")).toHaveLength(1);
    expect([a.posted, b.posted].filter(Boolean)).toHaveLength(1); // exactly one reports the write
    expect(a.posted ? b : a).toEqual({ posted: false, reason: "already" });
  });

  // Two DIFFERENT milestones arriving together, on an issue with no comment yet. Both would read
  // the thread, both would find no comment of this clone's, and both would post one — leaving two
  // comments where the whole design says there is one. The lock is per COMMENT, not per milestone.
  it("keeps two milestones arriving together from posting two comments", async () => {
    let releaseView = () => {};
    const held = new Promise<void>((resolve) => {
      releaseView = resolve;
    });
    const posts: string[] = [];
    let thread: string[] = [];
    let first = true;
    const run = async (args: string[]) => {
      if (args[1] === "view") {
        if (first) {
          first = false;
          await held; // the second caller is queued behind this one, not racing it
        }
        return { ok: true, stdout: issueView(thread), stderr: "" };
      }
      if (args[1] === "comment") {
        const body = args[args.indexOf("--body") + 1] ?? "";
        posts.push(body);
        thread = [...thread, body];
      }
      return { ok: true, stdout: "", stderr: "" };
    };

    const start = ensureWorkComment("o/r", 966, "start", "d", null, { runGh: run, now: NOW });
    const pr = ensureWorkComment("o/r", 966, "pr", "d", 1240, { runGh: run, now: NOW });
    releaseView();
    await Promise.all([start, pr]);

    expect(posts).toHaveLength(1); // one comment for the clone...
    expect(posts[0]).toContain("- started —"); // ...and the second milestone edited it
  });

  // A queued caller must not read "already" from a run that wrote nothing, or the retry never
  // happens — it takes its own turn instead.
  it("does not let a failed run answer for the one queued behind it", async () => {
    let releaseView = () => {};
    const held = new Promise<void>((resolve) => {
      releaseView = resolve;
    });
    const run = async (args: string[]) => {
      if (args[1] === "view") {
        await held;
        return { ok: false, stdout: "", stderr: "boom" };
      }
      return { ok: true, stdout: "", stderr: "" };
    };
    const first = ensureWorkComment("o/r", 966, "start", "d", null, { runGh: run });
    const second = ensureWorkComment("o/r", 966, "start", "d", null, { runGh: run });
    releaseView();
    expect(await Promise.all([first, second])).toEqual([
      { posted: false, reason: "gh-failed", failure: "unknown" },
      { posted: false, reason: "gh-failed", failure: "unknown" },
    ]);
  });

  // A restarted server has an empty memo; the thread is what stops it.
  it("stays quiet when a previous process already said it", async () => {
    const gh = fakeGh(issueView([renderWorkComment("mulmoterminal5", [STARTED])]));
    const result = await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(result).toEqual({ posted: false, reason: "already" });
    expect(gh.did("comment")).toBe(0);
    expect(gh.did("api")).toBe(0);
  });

  // The client sends whatever the cell can currently see, so a reload onto a branch that already
  // has a PR reports the start WITH a PR number. Starting work is not about that PR, and a comment
  // that gained a second `- started` line on every reload is exactly what the marker exists to
  // prevent (observed during review, not flagged by a bot).
  it("does not add a second started line when the reload reports a PR alongside it", async () => {
    const gh = fakeGh(issueView([renderWorkComment("mulmoterminal5", [STARTED])]));
    expect(await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", 983, { runGh: gh.run })).toEqual({ posted: false, reason: "already" });
    expect(gh.did("comment")).toBe(0);
    expect(gh.did("api")).toBe(0);
  });

  it("treats another directory's comment as somebody else's", async () => {
    const gh = fakeGh(issueView([renderWorkComment("mulmoterminal2", [STARTED])]));
    expect((await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run })).posted).toBe(true);
    expect(gh.did("comment")).toBe(1);
  });

  describe("a later milestone", () => {
    it("edits the comment this clone already has instead of posting a second one", async () => {
      const gh = fakeGh(issueView([renderWorkComment("mulmoterminal5", [STARTED])]));
      const result = await ensureWorkComment("o/r", 966, "pr", "mulmoterminal5", 1240, { runGh: gh.run, now: NOW });
      expect(result.posted).toBe(true);
      expect(gh.did("comment")).toBe(0);

      const edit = gh.argsFor("api") ?? [];
      // The REST id from the comment's URL — `--json comments` hands back a GraphQL node id, which
      // this endpoint does not accept.
      expect(edit).toContain("repos/o/r/issues/comments/5170970759");
      expect(edit).toContain("PATCH");
      const body = edit.join(" ");
      expect(body).toContain("- started — 2026-08-04 14:20 UTC"); // what was already there
      expect(body).toContain("- PR #1240 — 2026-08-04 15:05 UTC"); // and what is new
    });

    // A comment from a build that wrote no milestone lines still says work started — at the moment
    // it was posted. Dropping that would rewrite history as if the work began at the PR.
    it("takes the start time from a comment written before milestones existed", async () => {
      const old = `Working on this in \`mulmoterminal5\`.\n\n${workCommentMarker("start", "mulmoterminal5")}`;
      const gh = fakeGh(issueView([{ body: old, createdAt: "2026-08-01T09:30:00Z" }]));
      await ensureWorkComment("o/r", 966, "pr", "mulmoterminal5", 1240, { runGh: gh.run, now: NOW });
      expect(gh.argsFor("api")?.join(" ")).toContain("- started — 2026-08-01 09:30 UTC");
    });

    it("says nothing when the comment already records it", async () => {
      const events: WorkEvent[] = [STARTED, { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 1240 }];
      const gh = fakeGh(issueView([renderWorkComment("mulmoterminal5", events)]));
      expect(await ensureWorkComment("o/r", 966, "pr", "mulmoterminal5", 1240, { runGh: gh.run })).toEqual({ posted: false, reason: "already" });
      expect(gh.did("api")).toBe(0);
    });

    // An issue that was already in flight when the app was upgraded carries the older build's
    // SECOND comment, which the milestone lines cannot see. Saying it again would be a duplicate.
    it("treats an older build's separate merged comment as already said", async () => {
      const legacyMerged = `Merged in #983. Work done in \`mulmoterminal5\`.\n\n${workCommentMarker("merged", "mulmoterminal5")}`;
      const gh = fakeGh(issueView([renderWorkComment("mulmoterminal5", [STARTED]), { body: legacyMerged }]));
      expect(await ensureWorkComment("o/r", 966, "merged", "mulmoterminal5", 983, { runGh: gh.run, closeIssue: true })).toEqual({
        posted: false,
        reason: "already",
      });
      expect(gh.did("api")).toBe(0);
      expect(gh.did("close")).toBe(0);
    });

    // Reported as a failure rather than remembered: the issue must not freeze on its first line
    // because one response arrived without a URL to address the edit to.
    it("reports a comment it cannot address, without remembering it", async () => {
      const gh = fakeGh(issueView([{ body: renderWorkComment("mulmoterminal5", [STARTED]), url: "https://github.com/o/r/issues/966" }]));
      expect(await ensureWorkComment("o/r", 966, "pr", "mulmoterminal5", 1240, { runGh: gh.run })).toEqual({
        posted: false,
        reason: "gh-failed",
        failure: "unknown",
      });
      const working = fakeGh(issueView([renderWorkComment("mulmoterminal5", [STARTED])]));
      expect((await ensureWorkComment("o/r", 966, "pr", "mulmoterminal5", 1240, { runGh: working.run })).posted).toBe(true);
    });

    it("reports a failed edit without remembering it", async () => {
      const failing = fakeGh(issueView([renderWorkComment("d", [STARTED])]), { editOk: false });
      expect(await ensureWorkComment("o/r", 966, "pr", "d", 1240, { runGh: failing.run })).toEqual({ posted: false, reason: "gh-failed", failure: "unknown" });
      const working = fakeGh(issueView([renderWorkComment("d", [STARTED])]));
      expect((await ensureWorkComment("o/r", 966, "pr", "d", 1240, { runGh: working.run })).posted).toBe(true);
    });

    // `gh api` is addressed by hostname and a bare owner/repo, unlike `--repo` which takes the
    // entry whole. Leaving the host in the path would ask github.com about a repo named after a
    // server — the same shape of bug as #1332.
    it("addresses a GitHub Enterprise entry by hostname, not by path", async () => {
      const gh = fakeGh(issueView([renderWorkComment("d", [STARTED])]));
      await ensureWorkComment("ghe.example.com/o/r", 966, "pr", "d", 1240, { runGh: gh.run });
      const edit = gh.argsFor("api") ?? [];
      expect(edit).toContain("ghe.example.com");
      expect(edit).toContain("repos/o/r/issues/comments/5170970759");
    });
  });

  it("closes a still-open issue on merge", async () => {
    const gh = fakeGh(issueView([], "OPEN"));
    const result = await ensureWorkComment("o/r", 966, "merged", "mulmoterminal5", 983, { runGh: gh.run, closeIssue: true });
    expect(result).toEqual({ posted: true, closed: true });
    expect(gh.did("close")).toBe(1);
  });

  // `Fixes #N` means GitHub already closed it; asking again is noise on the timeline.
  it("does not close an issue GitHub already closed", async () => {
    const gh = fakeGh(issueView([], "CLOSED"));
    const result = await ensureWorkComment("o/r", 966, "merged", "mulmoterminal5", 983, { runGh: gh.run, closeIssue: true });
    expect(result).toEqual({ posted: true, closed: false });
    expect(gh.did("close")).toBe(0);
  });

  it("does not close on the start comment", async () => {
    const gh = fakeGh(issueView([], "OPEN"));
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(gh.did("close")).toBe(0);
  });

  // gh missing, not logged in, no network: say nothing and stay retryable — the memo must NOT
  // record a failure as done.
  it("reports a failed lookup without remembering it", async () => {
    const failing = fakeGh("", { viewOk: false });
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: failing.run })).toEqual({ posted: false, reason: "gh-failed", failure: "unknown" });
    const working = fakeGh(issueView([]));
    expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: working.run })).posted).toBe(true);
  });

  it("reports a failed write without remembering it", async () => {
    const failing = fakeGh(issueView([]), { commentOk: false });
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: failing.run })).toEqual({ posted: false, reason: "gh-failed", failure: "unknown" });
    const working = fakeGh(issueView([]));
    expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: working.run })).posted).toBe(true);
  });

  // The whole point of #1369's remaining item: a read-only login used to be indistinguishable
  // from the setting being off. The cause has to survive all the way to the caller, because the
  // caller is the only one that can put it in front of the user.
  describe("names why it could not write", () => {
    const FORBIDDEN = "gh: Resource not accessible by personal access token (HTTP 403)";
    const LOGGED_OUT = "To get started with GitHub CLI, please run:  gh auth login";

    it("reports a refused write as a permission problem", async () => {
      const gh = fakeGh(issueView([]), { commentOk: false, stderr: FORBIDDEN });
      expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: gh.run })).toEqual({
        posted: false,
        reason: "gh-failed",
        failure: "permission",
      });
    });

    it("reports a refused edit as a permission problem", async () => {
      const gh = fakeGh(issueView([renderWorkComment("d", [STARTED])]), { editOk: false, stderr: FORBIDDEN });
      const result = await ensureWorkComment("o/r", 966, "pr", "d", 1240, { runGh: gh.run });
      expect(result.failure).toBe("permission");
    });

    // The read fails for the same reasons as the write, and has the same fix.
    it("reports a refused lookup with its own cause", async () => {
      const gh = fakeGh("", { viewOk: false, stderr: LOGGED_OUT });
      expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: gh.run })).failure).toBe("auth");
    });

    // Nothing failed, so there is nothing to explain — a `failure` on a success would put a
    // notice on a cell whose issue was updated perfectly well.
    it("names no cause when it wrote, or when there was nothing to say", async () => {
      const wrote = await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: fakeGh(issueView([])).run });
      expect(wrote).toEqual({ posted: true, closed: false });
      const again = await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: fakeGh(issueView([])).run });
      expect(again).toEqual({ posted: false, reason: "already" });
    });

    // A permission grant or a `gh auth login` fixes it from outside this process, so a failure
    // must never be memoed as settled.
    it("tries again after the cause is fixed", async () => {
      const refused = fakeGh(issueView([]), { commentOk: false, stderr: FORBIDDEN });
      expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: refused.run })).failure).toBe("permission");
      const allowed = fakeGh(issueView([]));
      expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: allowed.run })).posted).toBe(true);
    });
  });

  it("keeps a failed close from failing the comment", async () => {
    const gh = fakeGh(issueView([], "OPEN"), { closeOk: false });
    expect(await ensureWorkComment("o/r", 966, "merged", "d", 1, { runGh: gh.run, closeIssue: true })).toEqual({ posted: true, closed: false });
  });

  it("survives a garbled issue view", async () => {
    const gh = fakeGh("not json");
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: gh.run })).toEqual({ posted: false, reason: "gh-failed", failure: "unknown" });
  });
});
