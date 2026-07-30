<script setup lang="ts">
// A −/value/+ nudger for the Settings modal's numeric per-browser settings (terminal font size,
// terminal scroll speed). Emits the SIGNED step, so the caller's nudge function takes it as-is.
//
// `label` is the setting in lower case as it reads inside a sentence ("terminal font size"), and
// becomes the buttons' accessible names: "Decrease terminal font size".
//
// `unit` is appended to the value as given — " px" carries its own leading space, "×" does not.
defineProps<{ value: number; unit: string; min: number; max: number; step: number; label: string }>();
const emit = defineEmits<{ (e: "nudge", delta: number): void }>();

const STEPPER_BUTTON =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";
</script>

<template>
  <div class="flex items-center gap-2">
    <button type="button" :class="STEPPER_BUTTON" :disabled="value <= min" :aria-label="`Decrease ${label}`" @click="emit('nudge', -step)">−</button>
    <span class="min-w-[56px] text-center text-[13px] text-fg" aria-live="polite">{{ value }}{{ unit }}</span>
    <button type="button" :class="STEPPER_BUTTON" :disabled="value >= max" :aria-label="`Increase ${label}`" @click="emit('nudge', step)">+</button>
  </div>
</template>
