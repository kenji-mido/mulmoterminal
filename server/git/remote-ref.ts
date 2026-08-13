// What a git remote URL says, with no opinion about which host it points at.
//
// Split out of gitRemote.ts (#981): the URL FORMS a remote can take — scp-like SSH, ssh://,
// https:// with credentials and a port, git:// — are a property of git, not of GitHub, and every
// forge uses the same ones. Keeping the parsing here means adding a host later is a rule about
// which `host` values are recognised, not a second copy of this parser.
//
// `path` is left whole rather than split into owner/repo: GitLab nests groups
// (`group/subgroup/project`), so how many segments identify a project is the HOST's rule.

export interface RemoteRef {
  /** Lower-cased hostname, e.g. `github.com`, `gitlab.example.com`. */
  host: string;
  /** Repository path with any `.git` suffix and surrounding slashes removed. */
  path: string;
}

export function parseRemoteRef(remoteUrl: string): RemoteRef | null {
  const url = remoteUrl.trim();
  if (!url) return null;
  // The scp-like form has no scheme (user@host:path), so the URL parser can't read it.
  const scp = /^[^/@]+@([^/:]+):([^:]+)$/.exec(url);
  const { host, rawPath } = scp ? { host: scp[1] ?? "", rawPath: scp[2] ?? "" } : fromUrl(url);
  const cleaned = cleanPath(rawPath);
  return host && cleaned ? { host: host.toLowerCase(), path: cleaned } : null;
}

function fromUrl(url: string): { host: string; rawPath: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, rawPath: parsed.pathname };
  } catch {
    return { host: "", rawPath: "" };
  }
}

function cleanPath(rawPath: string): string {
  return rawPath
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

/** The first `count` segments of a repository path, or null when there aren't that many —
 *  how many identify a project is the host's rule (GitHub: owner/repo; GitLab: nested groups). */
export function topSegments(repoPath: string, count: number): string | null {
  const segments = repoPath.split("/").filter(Boolean);
  return segments.length >= count ? segments.slice(0, count).join("/") : null;
}
