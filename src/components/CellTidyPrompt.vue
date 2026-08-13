<script setup lang="ts">
// "Its PR merged — tidy up?" on a worktree cell (#1182). WHEN it appears is `shouldPromptTidy`;
// this is only how it looks and the two things it can be told.
//
// A prompt rather than a chip, and so deliberately outside the configurable chip list: a user who
// removed the `work` chip still needs to be told their worktree is finished. It is also the only
// handle left at that point — the work-item chip hides itself at `merged`.
defineProps<{ pr: number }>();
const emit = defineEmits<{ (e: "tidy" | "dismiss"): void }>();
</script>

<template>
  <span
    data-testid="cell-tidy"
    class="inline-flex flex-none items-center gap-1 rounded-[10px] border border-accent bg-elevated px-[7px] py-px font-mono text-[11px]"
  >
    <button
      type="button"
      data-testid="cell-tidy-open"
      class="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-mono text-[11px] text-inherit hover:underline"
      :title="`PR #${pr} merged — remove this worktree, or keep it`"
      @click.stop="emit('tidy')"
    >
      <span class="material-symbols-outlined text-[13px]" aria-hidden="true">task_alt</span>#{{ pr }} merged — tidy up
    </button>
    <button
      type="button"
      data-testid="cell-tidy-dismiss"
      class="inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-inherit opacity-60 hover:opacity-100"
      title="Dismiss — this cell will not ask again for this PR"
      aria-label="Dismiss the tidy-up prompt"
      @click.stop="emit('dismiss')"
    >
      <span class="material-symbols-outlined text-[13px]" aria-hidden="true">close</span>
    </button>
  </span>
</template>
