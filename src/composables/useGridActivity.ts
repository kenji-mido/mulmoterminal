import { reactive, watch, onMounted, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { parseSessionActivityPayload, readCellActivity, type CellActivity } from "./sessionActivity";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// Live attention state (working / waiting / event) for a set of grid cell sessions,
// keyed by session id. Unlike the sidebar's /api/sessions list this includes
// dev-terminal (grid) sessions and is NOT capped by the list limit, so an OFF-PAGE
// (unmounted) cell still reports blocked/done — the fix for the grid's cross-page
// attention routing. Seeded from /api/activity (current in-memory state) and kept
// live from the "sessions" pub/sub payload.
export function useGridActivity(sessionIds: Ref<string[]>) {
  const activity = reactive(new Map<string, CellActivity>());

  // Non-null while a seed is in flight, keeping what the channel pushed meanwhile. /api/activity
  // answers as of the moment it was ASKED, so anything after that is newer than the answer
  // and has to go back on top of it — otherwise a cell that just started working is seeded
  // back to idle, and one that just closed reappears (#620 F3).
  let pushedDuringSeed: unknown[] | null = null;
  // Seeds overlap — mount, the cell-list watch and a reconnect all ask. Only the newest
  // answer may be applied: an older one describes a moment that has already been overtaken,
  // and applying it puts back what the newer state replaced.
  let latestSeed = 0;

  function apply(data: unknown): void {
    pushedDuringSeed?.push(data);
    const update = parseSessionActivityPayload(data);
    if (!update) return;
    if ("closed" in update) activity.delete(update.id);
    else activity.set(update.id, update.activity);
  }

  async function seed(): Promise<void> {
    const ids = [...new Set(sessionIds.value.filter(Boolean))];
    if (ids.length === 0) return;
    const seedId = ++latestSeed;
    const pushed: unknown[] = [];
    pushedDuringSeed = pushed;
    try {
      const res = await fetchWithTimeout(`/api/activity?ids=${encodeURIComponent(ids.join(","))}`);
      // Overtaken while we waited: this answer is older than what is on screen. Returning
      // also leaves the newer seed's record alone — it is the one that will replay.
      if (seedId !== latestSeed || !res.ok) return;
      // Each row goes through the SAME reader the live channel uses; the seed used to take the
      // whole map as CellActivity on the strength of the annotation alone.
      const data = await jsonBody(res);
      if (seedId !== latestSeed) return;
      for (const [id, raw] of Object.entries(data)) {
        const a = readCellActivity(raw);
        if (a) activity.set(id, a);
      }
      // Stop recording before replaying, or each replayed update records itself again.
      if (pushedDuringSeed === pushed) pushedDuringSeed = null;
      // In arrival order: a session that went working then closed must end up closed.
      pushed.forEach((update) => apply(update));
    } catch {
      // Transient — the pub/sub stream catches up on the next activity change.
    } finally {
      // A newer seed has taken over: leave its record alone.
      if (pushedDuringSeed === pushed) pushedDuringSeed = null;
    }
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;
  onMounted(() => {
    void seed();
    unsubscribe = subscribe("sessions", apply);
    // A dropped socket misses pushes; re-seed the authoritative state on reconnect.
    offReconnect = onReconnect(() => void seed());
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });
  // New cells (or a fresh session id after relaunch) need their current state seeded.
  watch(sessionIds, () => void seed());

  return { activity };
}
