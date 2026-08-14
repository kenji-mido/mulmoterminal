import { isRepoEntry } from "../../common/repoEntry";
import { normalizeGitlabHost } from "../../common/gitlabHosts";
// The "may I add this?" rules for the settings lists: a PR repo, a cell launcher, an HTTP MCP
// server. Each is a format check AND a uniqueness check, and each drives BOTH a button's
// disabled state and the add handler's guard. They were written twice per rule (the computed
// and the guard), which is how a validated-but-rejected input — an enabled button that does
// nothing — or the reverse slips in. One definition each, consumed by both.

// `owner/repo`, each side the GitHub-safe character set. A malformed value silently breaks the
// cross-repo PR view's fetch.

export function canAddRepo(repo: string, existing: readonly string[]): boolean {
  const trimmed = repo.trim();
  return isRepoEntry(trimmed) && !existing.includes(trimmed);
}

// A self-hosted GitLab host. Judged with the SAME normalizer the server sanitizes with, so a value
// the button accepts is one the config will keep — an entry that vanishes on save looks like the
// save failed. It also means a pasted `https://gitlab.example.com/` is accepted here too.
export function canAddGitlabHost(host: string, existing: readonly string[]): boolean {
  const normalized = normalizeGitlabHost(host);
  return normalized !== null && !existing.includes(normalized);
}

export function canAddLauncher(label: string, command: string, existing: readonly { label: string }[]): boolean {
  const l = label.trim();
  const c = command.trim();
  return !!l && !!c && !existing.some((entry) => entry.label === l);
}

// A phone chip: a label short enough to fit one, and the text it inserts. Same uniqueness rule
// as a launcher — the label is what the list and the chip show.
export function canAddQuickCommand(label: string, text: string, existing: readonly { label: string }[]): boolean {
  const l = label.trim();
  const t = text.trim();
  return !!l && !!t && !existing.some((entry) => entry.label === l);
}

// The id becomes the `mcp__<id>` tool prefix server-side, so it is restricted; the url must be
// http(s). A bad id breaks the tool namespace; a non-http url breaks the MCP connection.
const MCP_ID_RE = /^[A-Za-z0-9_-]+$/;
const MCP_URL_RE = /^https?:\/\/\S+$/;

export function canAddMcpServer(id: string, url: string, existing: readonly { id: string }[]): boolean {
  const i = id.trim();
  const u = url.trim();
  return MCP_ID_RE.test(i) && MCP_URL_RE.test(u) && !existing.some((entry) => entry.id === i);
}
