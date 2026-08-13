// Polls GET /api/git-status for a terminal's dir so the header can always show
// branch / dirty / ahead·behind. Refreshes on mount, on cwd change, and on the
// shared visible-only poll (window focus, tab visibility, a light interval) —
// see usePollWhileVisible. `refresh` is exposed so a caller can force an update
// right after a turn finishes.
import { ref, watch, type Ref } from "vue";
import { usePollWhileVisible } from "./usePollWhileVisible";
import type { GitStatus } from "../../common/gitStatus";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

const POLL_MS = 10_000;
const isGitStatus = (v: unknown): v is GitStatus => isRecord(v) && typeof v.repo === "boolean";

export function useGitStatus(cwd: Ref<string | null>) {
  const status = ref<GitStatus | null>(null);
  let req = 0;

  async function refresh(): Promise<void> {
    // Bump the token BEFORE the early return: switching a cell to a dir-less state (e.g. a
    // launcher cell) must invalidate an in-flight fetch for the previous dir, or its late
    // response would apply `my === req` and put the old branch chip back. (#620.)
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      status.value = null;
      return;
    }
    try {
      const res = await fetchWithTimeout(`/api/git-status?cwd=${encodeURIComponent(dir)}`, undefined, SLOW_COMMAND_TIMEOUT_MS);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my === req) status.value = isGitStatus(data) ? data : null;
    } catch {
      // leave the last value; the next tick retries
    }
  }

  usePollWhileVisible(() => void refresh(), POLL_MS);
  watch(cwd, refresh);

  return { status, refresh };
}
