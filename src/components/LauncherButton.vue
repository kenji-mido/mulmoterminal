<script setup lang="ts">
// The toolbar's icon-only tab button. One shared button so the launcher styling
// (size, active accent, hover) lives in one place and travels with any new tab.
const props = defineProps<{
  icon: string;
  title: string;
  label: string;
  active?: boolean;
  ariaPressed?: boolean;
  // An active state that is a WARNING rather than a selection — the setting is on but something
  // outside the app is stopping it. A glyph swap alone is not readable at 19px next to another
  // filled button, so the tone carries it; the app already means "needs you" by amber.
  tone?: "accent" | "warn";
}>();
defineEmits<{ (e: "click"): void }>();

// Each state names its own background AND ink: layering a tone over the accent fill would put two
// `bg-*` utilities on one element, and Tailwind's output order — not this expression — would pick.
const ACTIVE_TONE = { accent: "bg-accent-bg text-on-accent", warn: "bg-[var(--warn-bg-subtle)] text-warn" } as const;
const stateClass = () => (props.active ? ACTIVE_TONE[props.tone ?? "accent"] : "bg-transparent text-muted hover:bg-hover hover:text-fg");
</script>

<template>
  <button
    type="button"
    class="inline-flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-md border-0 p-0"
    :class="stateClass()"
    :title="title"
    :aria-label="label"
    :aria-pressed="ariaPressed"
    @click="$emit('click')"
  >
    <span class="material-symbols-outlined text-[19px] leading-none" aria-hidden="true">{{ icon }}</span>
  </button>
</template>
