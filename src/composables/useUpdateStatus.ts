import { ref, computed } from "vue";
import { parseUpdateNotice } from "./updateNotice";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { parseUpdateStatus, type UpdateStatus } from "../../common/updateStatus";

// The server runs the check at startup and it reaches the network (git ls-remote can take
// several seconds), so an early read answers with `ready: false`. Poll a few times to catch the
// result when it lands, then stop.
const POLL_MS = 3000;
const MAX_POLLS = 5;

// Module state, not per-caller: two components read this — the header badge and the Settings
// version line — and the answer is one server-side value that settles once. A second polling
// loop per consumer would re-ask a question already answered, and the modal would open with an
// empty line until its own fetch returned.
const status = ref<UpdateStatus | null>(null);
let polling = false;

async function fetchOnce(): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/update-status");
    if (!res.ok) return;
    // Assign whatever came back, including a status carrying no notice: a null must CLEAR a
    // notice an earlier read picked up (e.g. after a `git pull` + restart), not just be ignored.
    status.value = parseUpdateStatus(await jsonBody(res));
  } catch {
    // best-effort — no badge, no version line
  }
}

async function poll(polls: number): Promise<void> {
  await fetchOnce();
  if (status.value?.ready || polls + 1 >= MAX_POLLS) {
    polling = false;
    return;
  }
  setTimeout(() => void poll(polls + 1), POLL_MS);
}

// Ask again when a consumer appears and the answer still hasn't landed — the loop gives up after
// MAX_POLLS, and opening Settings ten minutes later must not inherit that dead end.
function startPolling(): void {
  if (polling || status.value?.ready) return;
  polling = true;
  void poll(0);
}

// What the header badge and the Settings version line read: the running install, and the update
// notice when there is one. Best-effort — any failure just leaves both hidden.
export function useUpdateStatus() {
  startPolling();
  return { status: computed(() => status.value), badge: computed(() => parseUpdateNotice(status.value?.notice)) };
}
