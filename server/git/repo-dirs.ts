// Which of the user's saved directories are clones of which GitHub repository (#1172).
//
// The app already knows dir -> repo (resolveGithubUrl + repoFromWebUrl, used by /api/pr-phase and
// the work comment). What was missing is the REVERSE: given `owner/repo`, where on this machine
// can work on it start? That is not a lookup but a choice — several clones of one repo commonly
// run side by side — so the answer is an ordered candidate list plus whichever one was recorded.
//
// The resolution is derived from `cwdPresets` rather than a second hand-kept list: a directory the
// user registered in Settings IS the set of places they work, and a mapping they had to maintain
// separately would drift the moment they added a clone.
import { repoForDir } from "./forge-support.js";
import { publicDirConfig } from "../config/dir-config.js";
import { createTtlCache } from "./ttl-cache.js";
import { orderByDirPriority } from "../../common/dirPriorityOrder.js";
import type { RepoDirCandidate, RepoDirs } from "../../common/repoDirs.js";
import type { CwdPreset } from "../config/config-schema.js";

// One `git config --get remote.origin.url` per saved directory, and a real setup has enough of
// them for that to be a visible cost on a route the UI polls. The remote of a clone effectively
// never changes, so the window can be generous; it is short enough that adding a directory in
// Settings shows up without a restart.
const CACHE_TTL_MS = 60_000;

const cache = createTtlCache<string | null>();
const cacheKeyOf = (dir: string): string => `repo:${dir}`;

export interface RepoDirsDeps {
  /** Injected for tests: the real one shells out to git in every saved directory. */
  repoOf?: (dir: string) => Promise<string | null>;
  priorityOf?: (dir: string) => number | null;
  now?: () => number;
  ttlMs?: number;
}

// `owner/repo` for a directory, or null when it is not a git repo, has no origin, or the origin
// is not on GitHub. All three are ordinary answers for a saved directory, not errors.
async function resolveRepo(dir: string): Promise<string | null> {
  return (await repoForDir(dir))?.repo ?? null;
}

async function cachedRepoOf(dir: string, deps: RepoDirsDeps): Promise<string | null> {
  const { repoOf = resolveRepo, now = Date.now, ttlMs = CACHE_TTL_MS } = deps;
  const key = cacheKeyOf(dir);
  const hit = cache.get(key, now, ttlMs);
  if (hit !== undefined) return hit;
  const repo = await repoOf(dir);
  cache.set(key, repo, now);
  return repo;
}

const priorityOfDir = (dir: string): number | null => publicDirConfig(dir).orderPriority;

// Sorted by path first, so that `orderByDirPriority` — which keeps equal ranks in the order it
// received them — leaves the directories that declare no priority in path order rather than in
// whatever order Settings happens to hold them. Two rules, one existing helper, no new sort.
function orderCandidates(candidates: RepoDirCandidate[]): RepoDirCandidate[] {
  const byPath = [...candidates].sort((a, b) => a.path.localeCompare(b.path));
  const priorityByPath: Record<string, number> = {};
  byPath.forEach(({ path, orderPriority }) => {
    if (orderPriority !== null) priorityByPath[path] = orderPriority;
  });
  return orderByDirPriority(byPath, (c) => c.path, priorityByPath);
}

// GitHub treats `Owner/Repo` and `owner/repo` as one repository, and the two spellings reach us
// from different places: a recording is keyed by whatever the UI had (which comes from the
// hand-typed `prRepos`), while an entry's own name is derived from the remote URL. An exact-key
// lookup made a saved choice silently fail to stick whenever those differed — the user picked a
// clone, it was written to the config, and the next read offered the menu again (Codex review).
function recordedDir(repo: string, recorded: Record<string, string>): string | undefined {
  const exact = recorded[repo];
  if (exact !== undefined) return exact;
  const wanted = repo.toLowerCase();
  return Object.entries(recorded).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

// A recorded choice is honoured only while it still names a clone of THAT repo. A directory that
// was deleted, or repointed at another project, would otherwise send the next session's work into
// the wrong tree — and silently, since the recording is invisible in the UI.
const recordedPrimary = (repo: string, dirs: RepoDirCandidate[], recorded: Record<string, string>): string | null => {
  const wanted = recordedDir(repo, recorded);
  return wanted && dirs.some((d) => d.path === wanted) ? wanted : null;
};

/** Group the saved directories by the GitHub repo they clone. Repos with no clone here simply do
 *  not appear — the caller reads that as "cannot start work on it", which is the truth. */
export async function repoDirsFromPresets(presets: readonly CwdPreset[], recorded: Record<string, string>, deps: RepoDirsDeps = {}): Promise<RepoDirs[]> {
  const { priorityOf = priorityOfDir } = deps;
  // Concurrently: each miss is its own `git` process, and a real preset list has enough entries
  // that resolving them one after another would be felt on the first (cold) request.
  const resolved = await Promise.all(presets.map(async (preset) => ({ preset, repo: await cachedRepoOf(preset.path, deps) })));

  const byRepo = new Map<string, RepoDirCandidate[]>();
  resolved.forEach(({ preset, repo }) => {
    if (!repo) return;
    const candidate: RepoDirCandidate = { path: preset.path, label: preset.label, orderPriority: priorityOf(preset.path) };
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), candidate]);
  });

  return [...byRepo.entries()]
    .map(([repo, candidates]) => {
      const dirs = orderCandidates(candidates);
      return { repo, dirs, primary: recordedPrimary(repo, dirs, recorded) };
    })
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Test-only: drop the per-directory remote cache so cases don't leak into each other. */
export function clearRepoDirsCache(): void {
  cache.clear();
}
