// Which FORGE a git remote points at — the layer between "what the URL says" (remote-ref.ts, pure
// git) and "what we can do with it" (the gh-backed features). #981 step 1.
//
// It exists because `parseGithubWebUrl` answers one question with `string | null`, which collapses
// two very different situations into the same value: "this is a GitLab repo" and "this directory
// has no origin at all". Every feature downstream reads that null as "no GitHub here" and removes
// itself, so a GitLab user gets silence rather than an explanation — and the surface doing that
// keeps growing (three more `gh` call sites arrived after #981 was written).
//
// Nothing here decides what to SHOW. Splitting the question from the answer is the point: the
// showing is a separate decision, and one this repo has not made yet.
import { parseRemoteRef, topSegments } from "./remote-ref.js";
import { isRepoEntry, parseRepoEntry } from "../../common/repoEntry.js";
import { isGitlabHost } from "../../common/gitlabHosts.js";

export type ForgeKind = "github" | "gitlab" | "unknown";

export interface RemoteForge {
  /** Lower-cased hostname the remote points at. */
  host: string;
  kind: ForgeKind;
  /** The repository path, whole. How many segments name a project is the host's rule, not git's. */
  path: string;
  /** The repository's web page, or null when the kind is not one we know how to address. */
  webUrl: string | null;
}

export const GITHUB_HOST = "github.com";
const GITLAB_HOST = "gitlab.com";

// Only the hosts we can name from the URL alone. A self-hosted GitLab at `git.example.com` is
// indistinguishable from anything else here, so the user declares it in `gitlabHosts` (#1332).
const KNOWN_HOSTS: Readonly<Record<string, ForgeKind>> = { [GITHUB_HOST]: "github", [GITLAB_HOST]: "gitlab" };

// The declared hosts, as a GETTER rather than a value: they come from the config, which is
// re-read on every POST /api/config, and a snapshot taken at boot would answer with whatever was
// on disk then. It is injected because the edge only runs one way — `server/git` already imports
// `server/config` (worktree-pr), so importing it back from here would close a cycle.
//
// The default is what this module did before the config existed, which is what keeps every spec
// and every caller that never wires it behaving exactly as it used to.
let declaredGitlabHosts: () => readonly string[] = () => [];

export const setDeclaredGitlabHosts = (source: () => readonly string[]): void => {
  declaredGitlabHosts = source;
};

const kindOf = (host: string): ForgeKind => KNOWN_HOSTS[host] ?? (isGitlabHost(host, declaredGitlabHosts()) ? "gitlab" : "unknown");

// GitHub: a project is exactly `owner/repo`, so a deeper path is truncated to it.
const GITHUB_PATH_SEGMENTS = 2;

// GitLab nests groups (`group/subgroup/project`), so the whole path names the project and there is
// no segment count to apply.
const projectPathFor = (kind: ForgeKind, path: string): string | null => {
  if (kind === "github") return topSegments(path, GITHUB_PATH_SEGMENTS);
  return kind === "gitlab" ? path : null;
};

/** How the host itself addresses this project — GitHub's `owner/repo`, GitLab's whole group path —
 *  or null for a host whose layout we do not know. */
export const projectPath = (forge: RemoteForge): string | null => projectPathFor(forge.kind, forge.path);

function webUrlFor(kind: ForgeKind, host: string, path: string): string | null {
  const project = projectPathFor(kind, path);
  return project ? `https://${host}/${project}` : null;
}

/** What forge a remote URL points at, or null when it is not a remote URL we can read at all. */
export function forgeOf(remoteUrl: string): RemoteForge | null {
  const ref = parseRemoteRef(remoteUrl);
  if (!ref) return null;
  return forgeAt(ref.host, ref.path);
}

const forgeAt = (host: string, path: string): RemoteForge => {
  const kind = kindOf(host);
  return { host, kind, path, webUrl: webUrlFor(kind, host, path) };
};

/** A configured repository entry as a forge, or null when it does not UNAMBIGUOUSLY name one.
 *
 *  Only the two forms are accepted, and a hostless entry must be exactly `owner/repo`. `a/b/c` is
 *  rejected rather than read as a GitHub path, because `gh --repo` takes `[HOST/]OWNER/REPO` and
 *  would treat the same string as host `a` — so accepting it would mean this parser and the CLI it
 *  feeds disagreeing about which server to talk to (Codex review).
 */
export function forgeFromRepoEntry(entry: string): RemoteForge | null {
  // Splitting an entry is common/repoEntry.ts's job — the browser reads the same rule. What stays
  // here is the SEGMENT COUNT, which is the forge's own: a hostless entry must be exactly
  // `owner/repo`, because `gh --repo` reads `a/b/c` as host `a` and would aim at another server
  // than this side thinks (Codex review). A declared host may be followed by a nested GitLab group.
  const parsed = isRepoEntry(entry) ? parseRepoEntry(entry) : null;
  return parsed ? forgeAt(parsed.host, parsed.path.join("/")) : null;
}
