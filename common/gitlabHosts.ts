// Which hosts are a GitLab this app can talk to (#1332). `gitlab.com` is known from its name; a
// self-hosted instance at `gitlab.hogefuga.com` is indistinguishable from any other host, so the
// user DECLARES it in `gitlabHosts` — the config mechanism #981 said this would need.
//
// In `common/` because both sides decide from it: the server picks a CLI from it, and the browser
// says why a control is off. Two copies would drift, and disagreeing is the failure the forge
// abstraction exists to undo.
import { GITHUB_HOST, GITLAB_HOST } from "./repoEntry.js";

// A hostname, lower case, with at least one dot. The dot is not cosmetic: `parseRepoEntry` reads a
// leading segment as a host ONLY when it contains one, so a dotless declaration could never match
// an entry and would sit in the config doing nothing.
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const SCHEME_RE = /^https?:\/\//;

const GITLAB_HOSTS_MAX = 20;

/** One declared host, or null when the string does not name one.
 *
 *  A pasted `https://gitlab.example.com/` is accepted and reduced to its hostname: this value is
 *  hand-typed into config.json with no UI to validate it, and the browser's address bar is where
 *  the user is copying from. Anything else with a slash is rejected rather than truncated — a
 *  project path here is a different mistake, and silently keeping its host would hide it.
 */
export function normalizeGitlabHost(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const host = input.trim().toLowerCase().replace(SCHEME_RE, "").replace(/\/$/, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

/** The declared hosts, de-duplicated and capped. Anything unusable is dropped rather than failing
 *  the whole config — one typo must not cost the user the hosts they spelled correctly. */
export function sanitizeGitlabHosts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const hosts = new Set<string>();
  for (const value of input) {
    const host = normalizeGitlabHost(value);
    if (host) hosts.add(host);
    if (hosts.size >= GITLAB_HOSTS_MAX) break;
  }
  return [...hosts];
}

/** Whether `host` is a GitLab: gitlab.com, or one the user declared.
 *
 *  `github.com` is refused whatever the config says. A declaration is a hand-typed line with no UI
 *  behind it, and the one that would do real damage — every GitHub repo suddenly addressed with
 *  `glab` — is also the easiest to write by accident.
 */
export const isGitlabHost = (host: string, declared: readonly string[]): boolean => host === GITLAB_HOST || (host !== GITHUB_HOST && declared.includes(host));

/** Why a host is not handled, and what to do about it.
 *
 *  ONE sentence, shared by the PRs/Issues row and the start-work refusal: #1332 was filed by a user
 *  who read "is not supported yet" and could not tell whether their setup was wrong, whether the
 *  feature was coming, or what to try — so the reason has to carry the fix.
 */
export const unknownForgeReason = (host: string): string =>
  `${host} is not supported yet — MulmoTerminal reads github.com and gitlab.com; if ${host} is a self-hosted GitLab, add it to "gitlabHosts" in ~/.mulmoterminal/config.json and restart`;
