// Starting work on an issue from the `/prs` row (#1173): find the repo's clones, ask the server
// to cut the worktree and seed a session in it, and show that session as a grid cell.
//
// The seeding is deliberately NOT done here. A prompt pasted into a cell that has just connected
// races claude's TUI boot and lands in the scrollback instead of the input box — see
// server/session/draft-injection.ts, which waits for the readiness marker. So the server spawns
// the session with the issue as a `draft` and this side only places the result, exactly as
// startCollectionChat does for the collection plugin.
import { ref } from "vue";
import { placeSpawnedChat } from "./useSpawnedChat";
import { issueStartPlan, type IssueStartPlan } from "./issueStartPlan";
import { isRecord } from "../../common/isRecord";
import { parseRepoDirsResponse, type RepoDirs } from "../../common/repoDirs";

// Loaded once per view open, like the PR and issue lists beside it: resolving a directory's remote
// is a `git` call per saved directory, and the answer only changes when the user edits Settings.
const repoDirs = ref<RepoDirs[]>([]);
const starting = ref<string | null>(null);
const startError = ref<string | null>(null);

const keyOf = (repo: string, issue: number): string => `${repo}#${issue}`;

export async function loadRepoDirs(): Promise<void> {
  try {
    const res = await fetch("/api/repo-dirs");
    if (!res.ok) return;
    repoDirs.value = parseRepoDirsResponse(await res.json());
  } catch {
    // Best-effort: the rows then read as "no clone", which disables the control rather than
    // offering one that cannot work.
    repoDirs.value = [];
  }
}

// GitHub treats `Owner/Repo` and `owner/repo` as one repository, and the two spellings arrive from
// different places: `prRepos` is typed by hand, the server's side comes from a remote URL.
export function clonesFor(repo: string): RepoDirs | undefined {
  const wanted = repo.toLowerCase();
  return repoDirs.value.find((r) => r.repo.toLowerCase() === wanted);
}

export const planFor = (repo: string): IssueStartPlan => issueStartPlan(clonesFor(repo));

/** Adopt a chosen clone into the loaded answer, and return the name to record it under.
 *
 *  Locally first, rather than waiting on the write or on another `/api/repo-dirs` read: without
 *  this the snapshot still says "several clones, nothing chosen", so the NEXT issue row in the same
 *  repo asked again — the choice only took effect after a reload (Codex review). The directory came
 *  from this repo's own candidate list, so it is already known to be one of them.
 *
 *  The returned name is the entry's own spelling — derived from the remote — so the config is keyed
 *  the way the server reads it rather than however `prRepos` happens to be typed. */
export function rememberClone(repo: string, dir: string): string {
  const entry = clonesFor(repo);
  if (!entry || !entry.dirs.some((d) => d.path === dir)) return repo;
  entry.primary = dir;
  return entry.repo;
}

async function requestStart(repo: string, issue: number, dir: string): Promise<boolean> {
  const res = await fetch("/api/issues/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo, issue, dir }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    startError.value = isRecord(data) && typeof data.error === "string" ? data.error : `could not start work on ${repo}#${issue}`;
    return false;
  }
  if (!isRecord(data) || typeof data.sessionId !== "string") {
    startError.value = "the server started nothing";
    return false;
  }
  // `draft: true` — the issue is typed into the input box and left there. It was written by
  // whoever opened the issue, which is usually not the person about to run it, so the Enter is
  // theirs to press.
  placeSpawnedChat({ id: data.sessionId, agent: "claude", draft: true });
  return true;
}

/** Cut the worktree and open the seeded session. `starting` names the row while it is in flight —
 *  a worktree add plus a spawn is slow enough that a second click would otherwise make two. */
export async function startIssueWork(repo: string, issue: number, dir: string): Promise<boolean> {
  if (starting.value) return false;
  starting.value = keyOf(repo, issue);
  startError.value = null;
  try {
    return await requestStart(repo, issue, dir);
  } catch {
    startError.value = `could not reach the server to start ${repo}#${issue}`;
    return false;
  } finally {
    starting.value = null;
  }
}

export function useIssueStart() {
  return {
    repoDirs,
    starting,
    startError,
    loadRepoDirs,
    clonesFor,
    planFor,
    startIssueWork,
    rememberClone,
    isStarting: (repo: string, issue: number) => starting.value === keyOf(repo, issue),
  };
}
