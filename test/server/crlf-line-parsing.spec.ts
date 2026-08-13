// @vitest-environment node
// Every rule in this repo that turns a blob of text into lines does it with `split("\n")` —
// about twenty places, over `git` / `gh` / `tmux` output, JSONL transcripts and bundled
// markdown. That is fine while the text arrives LF-terminated and silently wrong when it does
// not: a `\r` clings to the END of each line, so whatever the rule reads last carries it.
//
// Windows is where that happens — a file checked out with `core.autocrlf`, a tool that
// terminates its own output with CRLF — and it is invisible from a POSIX host, which is why
// these cases feed CRLF explicitly rather than relying on the platform.
//
// Each parser below is either safe BECAUSE it trims or JSON-parses (recorded, so a refactor
// that drops the trim is caught), or it is not (fixed).
import { describe, it, expect } from "vitest";
import { lastGhUrl, parseNumstatLine } from "../../server/git/git-parse";
import { splitLines } from "../../server/infra/split-lines";
import { parseWorktreeList } from "../../server/git/worktrees";
import { parseTmuxEnvironment } from "../../server/infra/tmux";
import { extractCwdFromTranscript } from "../../server/config/cwd-presets";
import { parseFaqEntries } from "../../server/skills/faqEntries";

const crlf = (...lines: string[]) => lines.join("\r\n");

describe("parseNumstatLine", () => {
  // The path is the LAST field, so it is exactly where a `\r` lands. A path with one clinging
  // to it is a path the client then asks the diff route for — and does not get.
  // The line ending belongs to the SPLIT, not to each parser — so these assert the
  // composition the diff route actually runs, which is where the `\r` used to survive.
  const numstat = (blob: string) =>
    splitLines(blob)
      .filter(Boolean)
      .map((line) => parseNumstatLine(line, Number));

  it("does not leave a carriage return on the path", () => {
    expect(numstat(crlf("3\t1\tsrc/a.ts", ""))).toEqual([{ path: "src/a.ts", additions: 3, deletions: 1 }]);
  });

  it("keeps a tab inside a path, which is a real (if rare) filename", () => {
    expect(numstat(crlf("1\t0\tdir/od\td", ""))[0].path).toBe("dir/od\td");
  });

  it("reads a binary file's dashes as -1, CRLF or not", () => {
    expect(numstat(crlf("-\t-\tbin/blob.png", ""))).toEqual([{ path: "bin/blob.png", additions: -1, deletions: -1 }]);
  });
});

describe("lastGhUrl", () => {
  // Safe because it trims each line. Pinned so a refactor that drops the trim is caught here
  // rather than by a PR link that 404s on Windows only.
  it("returns a URL with no carriage return attached", () => {
    const url = lastGhUrl(crlf("Creating pull request...", "https://github.com/o/r/pull/7", ""));
    expect(url).toBe("https://github.com/o/r/pull/7");
  });
});

describe("parseWorktreeList", () => {
  it("does not leave a carriage return on a path, head or branch", () => {
    const porcelain = crlf("worktree /repo/wt", "HEAD abc123", "branch refs/heads/agent/fix", "", "");
    expect(parseWorktreeList(porcelain)).toEqual([{ path: "/repo/wt", head: "abc123", branch: "agent/fix" }]);
  });
});

describe("parseTmuxEnvironment", () => {
  // This one splits values on newlines ON PURPOSE (an exported bash function spans lines), so
  // CRLF input is the case where "the value continues" and "the line ended" have to stay
  // distinguishable.
  it("does not fold a carriage return into a value", () => {
    const env = parseTmuxEnvironment(crlf("PATH=/usr/bin", "PREFIX=/opt/homebrew", ""));
    expect(env.get("PATH")).toBe("/usr/bin");
    expect(env.get("PREFIX")).toBe("/opt/homebrew");
  });
});

describe("extractCwdFromTranscript", () => {
  // Safe because JSON.parse tolerates trailing whitespace, and `\r` is whitespace.
  it("reads the cwd out of a CRLF-terminated JSONL line", () => {
    expect(extractCwdFromTranscript(crlf('{"type":"user","cwd":"/Users/me/proj"}', ""))).toBe("/Users/me/proj");
  });
});

describe("parseFaqEntries", () => {
  // The bundled faq.md is a repo file, so on Windows it is whatever git checked out — with
  // `core.autocrlf` on (the Windows default) that is CRLF. Its keys and paths are matched
  // against real config keys and real files by another test, so a `\r` on either would fail
  // there in a way that reads as "the entry is wrong" rather than "the file has CRLF".
  it("keeps no carriage return in a heading or a field value", () => {
    const entries = parseFaqEntries(crlf("## Enter submits instead of a newline", "configKey: terminalSubmit", "source: common/terminalSubmit.ts", ""));
    expect(entries).toHaveLength(1);
    expect(entries[0].symptom).toBe("Enter submits instead of a newline");
    expect(entries[0].configKeys).toEqual(["terminalSubmit"]);
    expect(entries[0].sources).toEqual(["common/terminalSubmit.ts"]);
  });
});
