<script setup lang="ts">
// "The server has been rebuilt — reload." Shown once this tab's client is out of step with the
// one the server now serves (see useBuildFreshness), and not dismissable: an out-of-date tab
// misbehaves in ways that read as bugs in the app, so the notice should stay until it is acted
// on. Reloading is the user's call — a tab that reloads itself takes a half-typed prompt with it.
import { useBuildFreshness } from "../composables/useBuildFreshness";

const { stale } = useBuildFreshness();

// Through window, not the bare global: the template compiles in the component's own scope, where
// `location` would resolve against the instance rather than the page.
function reloadNow(): void {
  window.location.reload();
}
</script>

<template>
  <div
    v-if="stale"
    data-testid="reload-prompt"
    role="status"
    class="fixed bottom-3 left-1/2 z-[200] flex max-w-[min(92%,520px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-accent bg-panel px-4 py-2.5 font-sans text-[13px] leading-[1.4] text-fg shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
  >
    <span class="material-symbols-outlined shrink-0 text-[18px]" aria-hidden="true">sync</span>
    <span class="min-w-0 flex-auto">MulmoTerminal was updated on the server. This tab is still running the old version.</span>
    <button
      type="button"
      data-testid="reload-now"
      class="flex-none cursor-pointer rounded-md border border-accent bg-accent px-3 py-1 text-[13px] font-semibold text-[var(--accent-fg,#fff)] hover:opacity-90"
      @click="reloadNow"
    >
      Reload
    </button>
  </div>
</template>
