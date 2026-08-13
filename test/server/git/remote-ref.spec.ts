// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseRemoteRef, topSegments } from "../../../server/git/remote-ref.js";

// The forms below are git's, not any one forge's — which is the reason this parser was split out
// of the GitHub-specific mapping (#981). Every case is therefore stated against a NON-GitHub host
// as well, so a future host needs a rule about `host`, not a second parser.

describe("parseRemoteRef", () => {
  it.each([
    ["scp-like SSH", "git@github.com:owner/repo.git", "github.com", "owner/repo"],
    ["scp-like SSH without .git", "git@github.com:owner/repo", "github.com", "owner/repo"],
    ["an SSH URL", "ssh://git@github.com/owner/repo.git", "github.com", "owner/repo"],
    ["an SSH URL with a port", "ssh://git@github.com:22/owner/repo.git", "github.com", "owner/repo"],
    ["HTTPS", "https://github.com/owner/repo.git", "github.com", "owner/repo"],
    ["HTTPS without .git", "https://github.com/owner/repo", "github.com", "owner/repo"],
    ["HTTPS with credentials", "https://user:token@github.com/owner/repo.git", "github.com", "owner/repo"],
    ["the git protocol", "git://github.com/owner/repo.git", "github.com", "owner/repo"],
  ])("reads %s", (_case, url, host, repoPath) => {
    expect(parseRemoteRef(url)).toEqual({ host, path: repoPath });
  });

  it.each([
    ["GitLab", "git@gitlab.com:group/project.git", "gitlab.com", "group/project"],
    ["a self-hosted forge over SSH", "git@git.example.com:team/tool.git", "git.example.com", "team/tool"],
    ["a self-hosted forge over HTTPS with a port", "https://git.example.com:8443/team/tool.git", "git.example.com", "team/tool"],
    ["Bitbucket", "https://bitbucket.org/team/repo.git", "bitbucket.org", "team/repo"],
  ])("reads %s the same way", (_case, url, host, repoPath) => {
    expect(parseRemoteRef(url)).toEqual({ host, path: repoPath });
  });

  // GitLab nests groups, so how many segments identify a project is the HOST's rule — the parser
  // keeps the path whole rather than deciding for it.
  it("keeps a nested group path whole", () => {
    expect(parseRemoteRef("git@gitlab.com:group/subgroup/project.git")).toEqual({ host: "gitlab.com", path: "group/subgroup/project" });
  });

  it("lower-cases the host, so a rule can compare it directly", () => {
    expect(parseRemoteRef("https://GitHub.COM/owner/repo")?.host).toBe("github.com");
  });

  it.each([
    ["surrounding whitespace", "  https://github.com/owner/repo\n", "owner/repo"],
    ["a trailing slash", "https://github.com/owner/repo/", "owner/repo"],
    ["repeated slashes", "https://github.com//owner//repo//", "owner/repo"],
    ["an upper-case .GIT suffix", "https://github.com/owner/repo.GIT", "owner/repo"],
  ])("normalises %s", (_case, url, repoPath) => {
    expect(parseRemoteRef(url)?.path).toBe(repoPath);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a bare word", "not-a-url"],
    ["a local path", "/srv/git/repo.git"],
    ["a host with no path", "https://github.com"],
    ["a host with only slashes", "https://github.com///"],
    ["a file:// remote, which has no host to attribute it to", "file:///srv/git/repo.git"],
  ])("returns null for %s", (_case, url) => {
    expect(parseRemoteRef(url)).toBeNull();
  });

  // A single segment is a real answer here (some forges do host `https://host/project`); it is the
  // per-host rule that decides whether that is enough, via topSegments.
  it("accepts a single-segment path", () => {
    expect(parseRemoteRef("https://git.example.com/project.git")).toEqual({ host: "git.example.com", path: "project" });
  });
});

describe("topSegments", () => {
  it("takes the leading segments a host's rule asks for", () => {
    expect(topSegments("owner/repo", 2)).toBe("owner/repo");
    expect(topSegments("group/subgroup/project", 2)).toBe("group/subgroup");
    expect(topSegments("group/subgroup/project", 3)).toBe("group/subgroup/project");
  });

  it("returns null when the path is shorter than the rule requires", () => {
    expect(topSegments("owner", 2)).toBeNull();
    expect(topSegments("", 1)).toBeNull();
  });

  it("ignores empty segments rather than counting them", () => {
    expect(topSegments("owner//repo", 2)).toBe("owner/repo");
  });
});
