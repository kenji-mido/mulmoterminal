// @vitest-environment node
// Which forge a remote points at. The distinction this layer exists to make is the one
// `parseGithubWebUrl` cannot: "a repo we do not support" vs "no remote at all" — both of which the
// GitHub-shaped answer reports as null (#981).
import { describe, it, expect } from "vitest";
import { forgeOf, type ForgeKind } from "../../../server/git/forge-host.js";

describe("forgeOf", () => {
  // The URL forms belong to git and are covered by remote-ref.spec; what matters here is that the
  // kind survives every one of them, since a user's remote could be written any of these ways.
  it.each([
    ["scp-like SSH", "git@github.com:owner/repo.git"],
    ["scp-like without .git", "git@github.com:owner/repo"],
    ["ssh:// URL", "ssh://git@github.com/owner/repo.git"],
    ["ssh:// with a port", "ssh://git@github.com:22/owner/repo.git"],
    ["https", "https://github.com/owner/repo.git"],
    ["https with credentials", "https://user:token@github.com/owner/repo.git"],
    ["git://", "git://github.com/owner/repo.git"],
  ])("reads github from a %s remote", (_form, url) => {
    expect(forgeOf(url)).toMatchObject({ host: "github.com", kind: "github", webUrl: "https://github.com/owner/repo" });
  });

  // How the value actually arrives: `git config --get remote.origin.url` ends in a newline, and
  // callers pass its stdout straight in. Pinned here now that it is this parser's job.
  it("trims the whitespace and trailing newline git leaves on its output", () => {
    expect(forgeOf("  git@github.com:owner/repo.git\n")).toMatchObject({ kind: "github", webUrl: "https://github.com/owner/repo" });
  });

  it("reads gitlab.com", () => {
    expect(forgeOf("git@gitlab.com:group/project.git")).toMatchObject({ host: "gitlab.com", kind: "gitlab" });
  });

  // The whole reason `path` is not split here: GitLab nests groups, so the project is the whole
  // path, while GitHub's is exactly the first two segments.
  it("keeps a nested GitLab group path whole", () => {
    expect(forgeOf("git@gitlab.com:group/sub/project.git")).toMatchObject({ path: "group/sub/project", webUrl: "https://gitlab.com/group/sub/project" });
  });

  it("truncates a deeper GitHub path to owner/repo", () => {
    expect(forgeOf("https://github.com/owner/repo/tree/main")).toMatchObject({ path: "owner/repo/tree/main", webUrl: "https://github.com/owner/repo" });
  });

  // The case that motivates the layer. A self-hosted forge is indistinguishable from any other
  // host by URL alone, so it is `unknown` — but it is NOT null, which is what lets a caller say
  // "this remote is on a host we do not support" instead of saying nothing.
  it.each([
    ["a self-hosted forge", "git@git.example.com:team/project.git"],
    ["a codeberg remote", "https://codeberg.org/owner/repo.git"],
  ])("reports %s as unknown rather than nothing", (_case, url) => {
    const forge = forgeOf(url);
    expect(forge).not.toBeNull();
    expect(forge?.kind).toBe("unknown");
    // No URL is invented for a host whose layout we do not know.
    expect(forge?.webUrl).toBeNull();
  });

  it("keeps the host so an unsupported remote can be named", () => {
    expect(forgeOf("git@git.example.com:team/project.git")?.host).toBe("git.example.com");
  });

  it("lower-cases the host, so a shouted remote is still recognised", () => {
    expect(forgeOf("git@GitHub.COM:owner/repo.git")).toMatchObject({ host: "github.com", kind: "github" });
  });

  // Null is reserved for "there is no remote here to read", which is what the callers treat as
  // "not a repo" — keeping it distinct from `unknown` is the point of the whole module.
  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["something that is not a URL", "not a remote"],
  ])("returns null for %s", (_case, url) => {
    expect(forgeOf(url)).toBeNull();
  });

  it("has no host that maps to a kind it cannot build a URL for", () => {
    const known: ForgeKind[] = ["github", "gitlab"];
    known.forEach((kind) => {
      const url = kind === "github" ? "git@github.com:o/r.git" : "git@gitlab.com:o/r.git";
      expect(forgeOf(url)?.webUrl).toBeTruthy();
    });
  });
});
