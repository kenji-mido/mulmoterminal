<script setup lang="ts">
import { computed } from "vue";
import { activeKeymap } from "../../composables/activeKeymap";
import { keymapRows, sendRows } from "../keymapLabels";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SECTION_HEADING } from "./sectionClasses";
import type { BundledSkillName } from "../../../common/bundledSkills";

const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

// Reactive, not a snapshot: /api/config is fetched asynchronously, so a modal opened before it
// lands would otherwise sit on "Not set" for every action until it is closed and reopened.
const shortcutRows = computed(() => keymapRows(activeKeymap.value));
const sendKeyRows = computed(() => sendRows(activeKeymap.value));
</script>

<template>
  <h3 :class="SECTION_HEADING">Keyboard shortcuts</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Read-only. Shortcuts are off until you bind them in <code>~/.mulmoterminal/config.json</code> under <code>keymap</code> — every key you bind stops reaching
    the program inside the terminal, so the skill checks a binding against what your agent already uses before writing it. Or see the
    <a class="text-accent underline" href="https://receptron.github.io/mulmoterminal/guide/en/config.html#keymap" target="_blank" rel="noopener noreferrer"
      >guide</a
    >.
  </p>
  <div class="flex flex-col gap-1" role="list" aria-label="Keyboard shortcuts">
    <div
      v-for="row in shortcutRows"
      :key="row.action"
      role="listitem"
      class="flex items-center gap-2 rounded-md border border-border bg-elevated px-2.5 py-1.5"
    >
      <span class="min-w-0 flex-1 truncate text-[12px] text-fg">{{ row.label }}</span>
      <code v-if="row.binding" class="shrink-0 rounded border border-border bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">{{ row.binding }}</code>
      <span v-else class="shrink-0 text-[11px] text-muted">Not set</span>
      <code class="shrink-0 font-mono text-[10px] text-muted">{{ row.action }}</code>
    </div>
    <div v-for="row in sendKeyRows" :key="row.id" role="listitem" class="flex items-center gap-2 rounded-md border border-border bg-elevated px-2.5 py-1.5">
      <span class="min-w-0 flex-1 truncate text-[12px] text-fg"
        >Send <code class="font-mono text-[11px]">{{ row.label }}</code> to the terminal</span
      >
      <code class="shrink-0 rounded border border-border bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">{{ row.key }}</code>
      <code class="shrink-0 font-mono text-[10px] text-muted">send</code>
    </div>
  </div>
  <div class="mt-3">
    <SkillLaunchButton skill="mulmoterminal-keys" icon="keyboard" label="Set up shortcuts…" @launch="emit('launch-skill', $event)" />
  </div>
</template>
