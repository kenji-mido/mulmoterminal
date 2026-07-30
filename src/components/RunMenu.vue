<script setup lang="ts">
import { watch, useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import { useDirScripts, type RunnableScript } from "../composables/useDirLists";
import type { RunCommand } from "./runCommand";

// A header dropdown that lists a directory's script.json entries and emits the one
// picked, so the parent can launch it. Scripts are fetched up front (and on cwd
// change) so the button only appears when the open project actually has scripts —
// no file, no button.
const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ (e: "run", command: RunCommand): void }>();

// The same list the launch form offers for a directory — including the resolved dir the entries
// belong to (the server may fall back from a bad path), which is where the picked command runs.
// No dir yet (e.g. a single-view reconnect before the session message arrives) reads as no
// scripts, rather than a fetch with an empty cwd that the server would resolve to the DEFAULT
// workspace — the wrong project's scripts.
const { value: scriptList, load: loadScripts } = useDirScripts();

const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef);

watch(
  () => props.cwd,
  (dir) => {
    // Close first: a cwd change invalidates the open dropdown (and would otherwise
    // leave the global listeners attached and the menu re-appearing pre-opened on a
    // later cwd, since the button can unmount while `open` stays true).
    close();
    void loadScripts(dir);
  },
  { immediate: true },
);

function pick(s: RunnableScript) {
  emit("run", { source: "script", index: s.index, label: s.label, cwd: scriptList.value.cwd ?? props.cwd });
  close();
}
</script>

<template>
  <div v-if="scriptList.scripts.length" ref="root" class="relative inline-flex">
    <button
      class="inline-flex items-center gap-1 border border-border bg-base text-secondary font-sans text-[12px] leading-none py-[5px] px-2.5 rounded-md cursor-pointer hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Run a script in a spare terminal"
      @click="toggle"
    >
      <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span> Run
      <span class="material-symbols-outlined" aria-hidden="true">{{ open ? "expand_less" : "expand_more" }}</span>
    </button>
    <div
      v-if="open"
      class="absolute top-[calc(100%+4px)] left-0 z-20 min-w-[180px] max-h-80 overflow-y-auto flex flex-col p-1 bg-panel border border-border rounded-md shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
      role="menu"
    >
      <button
        v-for="s in scriptList.scripts"
        :key="s.index"
        class="inline-flex items-center gap-1 text-left border-0 bg-transparent text-secondary font-mono text-[12px] py-1.5 px-2 rounded cursor-pointer whitespace-nowrap hover:bg-hover hover:text-fg"
        role="menuitem"
        :title="s.command"
        @click="pick(s)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span> {{ s.label }}
      </button>
    </div>
  </div>
</template>
