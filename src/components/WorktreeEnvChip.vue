<script setup lang="ts">
// The values this working tree was reserved (#1367): `:3010` for the port its dev server binds,
// `myapp_fix_login` for the database its migrations touch.
//
// It is on the header because the numbers are the point. A tree gets its own port precisely so
// two trees can run at once, and the moment that works the next question is which of the six
// cells answers on which number — a question `env | grep PORT` in the right pane answers, and a
// grid of six cells does not. A port is a link, so the tree's dev server is one click away.
import { computed } from "vue";
import type { WorktreeEnvValue } from "../../common/worktreeEnv";

const props = defineProps<{ values: readonly WorktreeEnvValue[] }>();

// A port shows as `:3010` — the whole variable name would cost more of the header than it
// explains, and the name is on the hover title either way. Anything else shows its value.
const label = (entry: WorktreeEnvValue): string => (entry.url ? `:${entry.value}` : entry.value);

const shown = computed(() => props.values.filter((entry) => entry.value !== ""));
</script>

<template>
  <span
    v-if="shown.length > 0"
    data-testid="worktree-env-chip"
    class="inline-flex h-[1.5em] max-w-[22ch] flex-none items-center gap-[0.35em] overflow-hidden whitespace-nowrap rounded-[0.75em] bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-[0.4em] font-sans text-[0.72rem] leading-[1.5em] opacity-85"
  >
    <a
      v-for="entry in shown"
      :key="entry.name"
      data-testid="worktree-env-value"
      :href="entry.url ?? undefined"
      :title="`${entry.name}=${entry.value}`"
      :target="entry.url ? '_blank' : undefined"
      :rel="entry.url ? 'noopener' : undefined"
      :class="['text-inherit no-underline', entry.url ? 'hover:underline' : 'pointer-events-none']"
      >{{ label(entry) }}</a
    >
  </span>
</template>
