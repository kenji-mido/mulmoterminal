<script setup lang="ts">
// A small modal confirmation for an irreversible action (permanent session delete). Kept
// generic — title/message/confirm-label are props — so other destructive actions can reuse it.
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string; danger?: boolean }>(), {
  confirmLabel: "Confirm",
  danger: false,
});
const emit = defineEmits<{ (e: "confirm" | "cancel"): void }>();
</script>

<template>
  <div class="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(0,0,0,0.55)]" @click.self="emit('cancel')">
    <div
      class="flex w-[min(420px,92vw)] flex-col gap-3 rounded-[10px] border border-border bg-base p-4 font-sans text-fg"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <h2 class="m-0 text-[15px] font-semibold">{{ title }}</h2>
      <p class="m-0 text-[13px] leading-[1.5] text-muted">{{ message }}</p>
      <div class="mt-1 flex items-center justify-end gap-2">
        <button
          class="cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
          data-testid="confirm-cancel"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="cursor-pointer rounded-md border px-3 py-1.5 text-[13px] font-semibold text-[var(--accent-fg,#fff)] hover:opacity-90"
          :class="danger ? 'border-[var(--err-text,#e5484d)] bg-[var(--err-text,#e5484d)]' : 'border-accent bg-accent'"
          data-testid="confirm-ok"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
