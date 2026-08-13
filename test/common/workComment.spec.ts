// The comment body is its own storage: the server renders it, reads it back on the next milestone,
// and appends to what it parsed. So the property that matters here is that render and parse are
// inverses — anything they disagree about is a milestone that silently disappears from the issue.
import { describe, it, expect } from "vitest";
import {
  alreadyCommented,
  formatWorkTime,
  isWorkCommentKind,
  parseWorkEvents,
  renderWorkComment,
  withWorkEvent,
  workAnchorMarker,
  workCommentDirLabel,
  workCommentMarker,
  type WorkEvent,
} from "../../common/workComment";

const START: WorkEvent = { kind: "start", at: "2026-08-04 14:20 UTC", pr: null };
const PR: WorkEvent = { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 1240 };
const MERGED: WorkEvent = { kind: "merged", at: "2026-08-04 16:40 UTC", pr: 1240 };

describe("workCommentDirLabel", () => {
  it.each([
    ["/Users/me/ss/llm/mulmoterminal5", "mulmoterminal5"],
    ["/Users/me/ss/llm/mulmoterminal5/", "mulmoterminal5"],
    ["C:\\work\\acme-web", "acme-web"],
    ["mulmoclaude4", "mulmoclaude4"],
  ])("names %s as %s", (cwd, expected) => {
    expect(workCommentDirLabel(cwd)).toBe(expected);
  });

  // The reason it is the basename: the comment lands on a public issue.
  it("never carries the path above the directory", () => {
    expect(workCommentDirLabel("/Users/someone/private-client/secret-project")).toBe("secret-project");
  });
});

describe("formatWorkTime", () => {
  it("writes minutes in UTC, so two clones in two timezones write comparable lines", () => {
    expect(formatWorkTime(new Date("2026-08-04T14:20:31.500Z"))).toBe("2026-08-04 14:20 UTC");
  });

  it("reports UTC for a time given in another zone", () => {
    expect(formatWorkTime(new Date("2026-08-04T23:20:00+09:00"))).toBe("2026-08-04 14:20 UTC");
  });
});

describe("isWorkCommentKind", () => {
  it.each(["start", "pr", "merged"])("accepts %s", (kind) => expect(isWorkCommentKind(kind)).toBe(true));
  it.each([["ci-failing"], [""], [null], [1], [{ kind: "start" }]])("refuses %j", (value) => expect(isWorkCommentKind(value)).toBe(false));
});

describe("renderWorkComment", () => {
  const dir = "1234-fix-login";

  it("says where the work is happening and carries the marker that identifies the comment", () => {
    const body = renderWorkComment(dir, [START]);
    expect(body).toContain("Working on this in `1234-fix-login`.");
    expect(body).toContain("- started — 2026-08-04 14:20 UTC");
    expect(body).toContain(workAnchorMarker(dir));
  });

  // It lands on other people's issues, so a reader must not have to guess what is claiming theirs.
  it("signs itself", () => {
    expect(renderWorkComment(dir, [START])).toContain("[MulmoTerminal](https://github.com/receptron/mulmoterminal)");
  });

  it("names the PR the merge came in as, in the headline and in the line", () => {
    const body = renderWorkComment(dir, [START, PR, MERGED]);
    expect(body).toContain("Merged in #1240. Work done in `1234-fix-login`.");
    expect(body).toContain("- merged in #1240 — 2026-08-04 16:40 UTC");
  });

  it("still reads as a sentence when the merge names no PR", () => {
    expect(renderWorkComment(dir, [START, { ...MERGED, pr: null }])).toContain("Merged. Work done in `1234-fix-login`.");
  });

  // A milestone that cannot be written as a line the parser reads back would vanish on the next
  // edit, taking the whole rest of the comment's history with it.
  it("drops a PR milestone with no number rather than writing a line it cannot read back", () => {
    expect(renderWorkComment(dir, [START, { kind: "pr", at: "2026-08-04 15:05 UTC", pr: null }])).not.toContain("PR");
  });

  // A directory may legally be called `foo\n- started — …`, and that name goes into the headline.
  it("keeps a directory name from putting a line of its own in the body", () => {
    const odd = "evil\n- started — 2020-01-01 00:00 UTC";
    expect(parseWorkEvents(renderWorkComment(odd, [PR]))).toEqual([PR]);
  });
});

describe("render and parse are inverses", () => {
  it.each([
    ["one milestone", [START]],
    ["two", [START, PR]],
    ["the whole story", [START, PR, MERGED]],
    ["a merge with no PR", [START, { ...MERGED, pr: null }]],
    ["a second PR after the first was closed", [START, PR, { kind: "pr", at: "2026-08-05 09:00 UTC", pr: 1250 } as WorkEvent]],
  ])("round-trips %s", (_case, events) => {
    expect(parseWorkEvents(renderWorkComment("mulmoterminal5", events))).toEqual(events);
  });

  it("keeps the order the milestones happened in", () => {
    expect(parseWorkEvents(renderWorkComment("d", [START, PR, MERGED])).map((e) => e.kind)).toEqual(["start", "pr", "merged"]);
  });

  // The number the pattern reads back and the number render is willing to write are ONE bound. A
  // line render emitted and parse dropped would disappear on the next edit, taking its milestone
  // with it (Codex review of the bound itself).
  it("round-trips the largest number a line can carry", () => {
    const big: WorkEvent = { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 9999999999 };
    expect(parseWorkEvents(renderWorkComment("d", [START, big]))).toEqual([START, big]);
  });

  it("writes no PR line it could not read back", () => {
    const tooBig: WorkEvent = { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 10000000000 };
    expect(renderWorkComment("d", [START, tooBig])).not.toContain("PR #");
    expect(parseWorkEvents(renderWorkComment("d", [START, tooBig]))).toEqual([START]);
  });

  // The merge itself still happened, so the milestone stays and only the number goes — and the
  // headline drops it too, or the comment would name a number the line beneath it does not.
  it("keeps a merge whose number is too large, without the number", () => {
    const merged: WorkEvent = { kind: "merged", at: "2026-08-04 16:40 UTC", pr: 10000000000 };
    const body = renderWorkComment("d", [START, merged]);
    expect(body).toContain("Merged. Work done in `d`.");
    expect(body).not.toContain("10000000000");
    expect(parseWorkEvents(body)).toEqual([START, { ...merged, pr: null }]);
  });
});

describe("parseWorkEvents", () => {
  // What builds before #1369 wrote: the marker and the headline, no lines. The caller supplies the
  // start from the comment's own creation time, so an empty answer must be reported honestly.
  it("finds nothing in a comment written before milestones existed", () => {
    expect(parseWorkEvents("Working on this in `mulmoterminal5`.\n\n<!-- mulmoterminal:work:start dir=mulmoterminal5 -->")).toEqual([]);
  });

  // A body round-tripped through the forge can come back CRLF.
  it("reads a body that came back with CRLF line endings", () => {
    expect(parseWorkEvents(renderWorkComment("d", [START, PR]).replace(/\n/g, "\r\n"))).toEqual([START, PR]);
  });

  // Anyone reading the issue can edit this comment, and whatever parse returns is written straight
  // back on the next milestone. A line that is not exactly what render wrote is dropped, not echoed.
  it.each([
    ["a mangled timestamp", "- started — yesterday"],
    ["a timestamp in another zone", "- started — 2026-08-04 14:20 JST"],
    ["prose that looks like a line", "- started — see the thread"],
    ["seconds nobody wrote", "- started — 2026-08-04 14:20:31 UTC"],
    // `Number("9".repeat(20))` is 1e20, which would be written back as `- PR #1e+20`. The pattern
    // bounds the digits, so such a line does not match at all.
    ["a PR number too large to be one", `- PR #${"9".repeat(20)} — 2026-08-04 15:05 UTC`],
    ["a merge naming a PR number too large to be one", `- merged in #${"9".repeat(20)} — 2026-08-04 16:40 UTC`],
  ])("drops %s", (_case, line) => {
    expect(parseWorkEvents(`Working on this.\n\n${line}\n`)).toEqual([]);
  });

  it("ignores the signature and the marker", () => {
    expect(parseWorkEvents(renderWorkComment("d", []))).toEqual([]);
  });

  // The bound in the pattern is what makes `Number` exact here, so it has to be wide enough for a
  // real forge: GitHub's own numbers are seven digits, and this reads ten.
  it("still reads a number far larger than any forge issues", () => {
    expect(parseWorkEvents("- PR #1234567890 — 2026-08-04 15:05 UTC")).toEqual([{ kind: "pr", at: "2026-08-04 15:05 UTC", pr: 1234567890 }]);
  });
});

describe("withWorkEvent", () => {
  it("adds a milestone the comment does not have", () => {
    expect(withWorkEvent([START], PR)).toEqual([START, PR]);
  });

  // The property the whole module exists for: the caller asks on every poll of every open tab.
  it("says nothing to do when the milestone is already recorded", () => {
    expect(withWorkEvent([START, PR], PR)).toBeNull();
    expect(withWorkEvent([START], { ...START, at: "2026-09-01 00:00 UTC" })).toBeNull();
  });

  // A second pull request from the same clone — the first closed unmerged — is its own milestone.
  it("tells two pull requests apart", () => {
    expect(withWorkEvent([START, PR], { kind: "pr", at: "2026-08-05 09:00 UTC", pr: 1250 })).toHaveLength(3);
  });

  it("refuses a PR milestone with no number, which has nothing to say", () => {
    expect(withWorkEvent([START], { kind: "pr", at: "2026-08-04 15:05 UTC", pr: null })).toBeNull();
  });

  // Refused here rather than added and then silently dropped by render, which would leave the
  // caller believing a milestone was recorded.
  it("refuses a PR number the line could not carry", () => {
    expect(withWorkEvent([START], { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 10000000000 })).toBeNull();
    expect(withWorkEvent([START], { kind: "pr", at: "2026-08-04 15:05 UTC", pr: 9999999999 })).toHaveLength(2);
  });
});

describe("alreadyCommented", () => {
  const dir = "mulmoterminal5";

  it("finds its own marker in a thread of other comments", () => {
    expect(alreadyCommented(["LGTM", renderWorkComment(dir, [START]), "thanks"], "start", dir)).toBe(true);
  });

  // The merged marker is an OLDER build's second comment. A comment carrying the anchor is not it.
  it("does not confuse the two kinds", () => {
    expect(alreadyCommented([renderWorkComment(dir, [START, MERGED])], "merged", dir)).toBe(false);
  });

  // A second clone working the same issue is a second honest line, not a duplicate.
  it("does not confuse two directories", () => {
    expect(alreadyCommented([renderWorkComment("mulmoterminal2", [START])], "start", dir)).toBe(false);
  });

  it("says no for an empty thread", () => {
    expect(alreadyCommented([], "start", dir)).toBe(false);
  });

  // A directory may legally be called `foo-->bar`, and that string closes the HTML comment early:
  // the rest of the marker spills into the rendered issue as visible text (Codex review). The
  // payload is encoded, so the comment stays a comment — and still round-trips.
  it.each(["foo-->bar", "a b", "back`tick", "dir-名前"])("keeps the marker intact for a directory called %j", (odd) => {
    const marker = workCommentMarker("start", odd);
    expect(marker.indexOf("-->")).toBe(marker.length - 3); // exactly one terminator, at the end
    expect(alreadyCommented([renderWorkComment(odd, [START])], "start", odd)).toBe(true);
  });

  // Encoding must not make two different directories look like one.
  it("still tells two odd directories apart", () => {
    expect(alreadyCommented([renderWorkComment("a b", [START])], "start", "a%20b")).toBe(false);
  });

  // Markers written before the encoding existed must keep matching, or every issue gets a
  // duplicate the first time the new build runs.
  it("leaves an ordinary directory name byte-identical", () => {
    expect(workCommentMarker("start", "mulmoterminal5")).toBe("<!-- mulmoterminal:work:start dir=mulmoterminal5 -->");
  });
});
