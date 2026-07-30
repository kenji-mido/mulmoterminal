<script setup lang="ts">
// One saved entry in a Settings list, with the button that removes it. The four lists (PR repos,
// launchers, phone quick commands, MCP servers) all show a row this shape, so the frame and the
// remove button are one decision; what the row SAYS is the slot.
//
// `name` is what the entry is called in the list — the repo, the launcher's label, the server id.
// It only reaches the accessible name, so a screen reader hears which entry a button removes
// rather than fourteen buttons all called "Remove".
defineProps<{ name: string }>();
const emit = defineEmits<{ (e: "remove"): void }>();
</script>

<template>
  <li class="flex items-center gap-2 rounded-md border border-border bg-elevated py-1 pl-2.5 pr-1.5">
    <slot />
    <button
      class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
      type="button"
      :title="`Remove ${name}`"
      :aria-label="`Remove ${name}`"
      @click="emit('remove')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
  </li>
</template>
