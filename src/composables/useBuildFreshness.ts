// Whether this tab is still running the client the server serves.
//
// A tab keeps the JavaScript it loaded. Restart the server with a new bundle and every open tab
// carries on with the old one, indefinitely and without a word — which is how an afternoon went
// into reproducing behaviour that had already been fixed, in a tab nobody thought to reload.
//
// So: remember the server's build id at load, and compare on every pub/sub RECONNECT. A server
// restart drops those sockets and every client reconnects, which makes it the moment the answer
// can have changed — no polling, no timer, and the check costs one request per reconnect.
//
// Deliberately only a FLAG. Reloading a tab by itself would take a half-typed prompt with it, and
// the person is the one who knows whether this second is a good time.
import { ref, onMounted, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";

async function fetchBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const id = (data as { buildId?: unknown }).buildId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null; // offline / mid-restart — say nothing rather than guess
  }
}

/** True once the server is serving a DIFFERENT client than this tab loaded. Never true when
 *  either side has no build to name (a dev server), and never goes back to false: the tab cannot
 *  become current again without being reloaded. */
export function isStaleBuild(loaded: string | null, current: string | null): boolean {
  if (!loaded || !current) return false;
  return loaded !== current;
}

export function useBuildFreshness(): { stale: Ref<boolean> } {
  const stale = ref(false);
  let loaded: string | null = null;

  const check = async () => {
    const current = await fetchBuildId();
    if (loaded === null) {
      loaded = current; // first answer: this is the build we are running
      return;
    }
    if (isStaleBuild(loaded, current)) stale.value = true;
  };

  const { onReconnect } = usePubSub();
  let off: (() => void) | undefined;
  onMounted(() => {
    void check();
    off = onReconnect(() => void check());
  });
  onUnmounted(() => off?.());

  return { stale };
}
