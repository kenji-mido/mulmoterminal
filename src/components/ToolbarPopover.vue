<script setup lang="ts">
// Shared scaffold for the toolbar popovers (notifications, remote host): a square
// icon trigger that toggles an anchored panel. Owns the open/close state and the
// outside-click / Escape dismissal via useDropdownMenu; each consumer supplies its
// own trigger extras (slot) and panel body (default slot).
import { computed, useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";

const props = defineProps<{
  icon: string;
  title: string;
  triggerLabel: string;
  paneClass: string;
  paneLabel: string;
  triggerClass?: Record<string, boolean>;
}>();

const emit = defineEmits<{ open: [] }>();

const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef, () => emit("open"));

// The trigger's colour, resolved to ONE class rather than layered rules that race.
//
// As CSS this was `:hover`/`.active` setting the colour and `.connected`/`.disconnected`
// re-setting it, relying on being declared later to win — a fragility the old stylesheet's
// own comment called out, because the alarm colour would vanish exactly while the user had
// the panel open reading about it. Choosing here means declaration order cannot matter: the
// reachability state outranks "open" by construction, and the hover colour is only in play
// when there is no state to report.
const TONE_NEUTRAL = "text-muted hover:text-fg";
const triggerTone = computed(() => {
  if (props.triggerClass?.disconnected) return "text-[var(--err-strong)]";
  if (props.triggerClass?.connected) return "text-[#35c46a]";
  return open.value ? "text-fg" : TONE_NEUTRAL;
});

defineExpose({ close });
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <button
      type="button"
      class="relative inline-flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 hover:bg-hover"
      :class="[triggerTone, { 'bg-hover': open }]"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="title"
      :aria-label="triggerLabel"
      @click="toggle"
    >
      <span class="material-symbols-outlined text-[19px] leading-none" aria-hidden="true">{{ icon }}</span>
      <slot name="trigger-extra" />
    </button>

    <!-- z-60 clears the collections browse overlay (z-50, which fills everything below the
         toolbar), so a navigation that opens this dropdown doesn't leave it hidden. -->
    <div
      v-if="open"
      class="absolute right-0 top-[calc(100%+6px)] z-60 flex flex-col rounded-lg border border-border bg-panel shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
      :class="paneClass"
      role="group"
      :aria-label="paneLabel"
    >
      <slot />
    </div>
  </div>
</template>
