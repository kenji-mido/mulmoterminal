// The declaration itself (#1332). It is hand-typed into config.json with no UI to check it, so the
// two things that matter are that a plausible spelling is accepted and that a wrong one is dropped
// rather than half-read.
import { describe, it, expect } from "vitest";
import { isGitlabHost, normalizeGitlabHost, sanitizeGitlabHosts, unknownForgeReason } from "../../common/gitlabHosts";

describe("normalizeGitlabHost", () => {
  it.each([
    ["a plain hostname", "gitlab.hogefuga.com", "gitlab.hogefuga.com"],
    ["upper case", "GitLab.Hogefuga.COM", "gitlab.hogefuga.com"],
    ["surrounding space", "  gitlab.hogefuga.com ", "gitlab.hogefuga.com"],
    // What the user is copying from is a browser address bar, so this is the likely paste.
    ["a pasted https URL", "https://gitlab.hogefuga.com/", "gitlab.hogefuga.com"],
    ["a pasted http URL", "http://gitlab.internal.example", "gitlab.internal.example"],
    ["a hyphenated host", "git-lab.example.co.jp", "git-lab.example.co.jp"],
  ])("accepts %s", (_case, input, expected) => {
    expect(normalizeGitlabHost(input)).toBe(expected);
  });

  it.each([
    ["an empty string", ""],
    ["something that is not a string", 5],
    // A project path is a different mistake. Keeping only its host would hide it, and the entry
    // that names the project belongs in `prRepos`.
    ["a project path", "gitlab.hogefuga.com/group/project"],
    ["a URL with a path", "https://gitlab.hogefuga.com/group/project"],
    ["a space inside", "gitlab hogefuga com"],
    // No dot means it can never match: `parseRepoEntry` only reads a DOTTED leading segment as a
    // host, so a declaration like this would sit in the config doing nothing.
    ["a dotless name", "gitlab"],
    ["a port", "gitlab.hogefuga.com:8443"],
  ])("rejects %s", (_case, input) => {
    expect(normalizeGitlabHost(input)).toBeNull();
  });
});

describe("sanitizeGitlabHosts", () => {
  it("keeps the good entries and drops the rest", () => {
    expect(sanitizeGitlabHosts(["gitlab.hogefuga.com", "nope", 5, "https://gitlab.two.example"])).toEqual(["gitlab.hogefuga.com", "gitlab.two.example"]);
  });

  it("de-duplicates spellings that mean the same host", () => {
    expect(sanitizeGitlabHosts(["gitlab.hogefuga.com", "GITLAB.HOGEFUGA.COM", "https://gitlab.hogefuga.com/"])).toEqual(["gitlab.hogefuga.com"]);
  });

  it.each([
    ["a missing key", undefined],
    ["not a list", "gitlab.hogefuga.com"],
  ])("is empty for %s", (_case, input) => {
    expect(sanitizeGitlabHosts(input)).toEqual([]);
  });
});

describe("isGitlabHost", () => {
  it("is true for gitlab.com with nothing declared", () => {
    expect(isGitlabHost("gitlab.com", [])).toBe(true);
  });

  it("is true for a declared host, and false for one that is not", () => {
    expect(isGitlabHost("gitlab.hogefuga.com", ["gitlab.hogefuga.com"])).toBe(true);
    expect(isGitlabHost("gitea.example.com", ["gitlab.hogefuga.com"])).toBe(false);
  });

  // The one wrong declaration that would do real damage — every GitHub repo addressed with `glab` —
  // is also the easiest to write by accident, so it is refused here rather than at each caller.
  it("refuses github.com however it is declared", () => {
    expect(isGitlabHost("github.com", ["github.com"])).toBe(false);
  });
});

describe("unknownForgeReason", () => {
  it("says which host, and what to add where", () => {
    const reason = unknownForgeReason("gitea.example.com");
    expect(reason).toContain("gitea.example.com");
    expect(reason).toContain("gitlabHosts");
    expect(reason).toContain("~/.mulmoterminal/config.json");
  });
});
