<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

// A −/value/+ nudger for the Settings modal's numeric per-browser settings (terminal font size,
// terminal scroll speed). Emits the SIGNED step, so the caller's nudge function takes it as-is.
//
// `label` is the setting in lower case as it reads inside a sentence ("terminal font size"), and
// becomes the buttons' accessible names: "Decrease terminal font size".
//
// `unit` is appended to the value as given — " px" carries its own leading space, "×" does not.
//
// `disabled` is for a stepper whose whole SETTING is off — the interval of a background task that
// is not running. Greying the container with `pointer-events-none` is not enough on its own: it
// stops the mouse and nothing else, so a keyboard user tabs to the button, presses it, and saves a
// value the screen says is unavailable (Codex review on #1412).
const props = defineProps<{ value: number; unit: string; min: number; max: number; step: number; label: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: "nudge", delta: number): void }>();

const { t } = useI18n();

const atMin = computed(() => props.disabled || props.value <= props.min);
const atMax = computed(() => props.disabled || props.value >= props.max);

const STEPPER_BUTTON =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40";
</script>

<template>
  <div class="flex items-center gap-2">
    <button type="button" :class="STEPPER_BUTTON" :disabled="atMin" :aria-label="t('settings.stepper.decrease', { label })" @click="emit('nudge', -step)">
      −
    </button>
    <span class="min-w-[56px] text-center text-[13px] text-fg" aria-live="polite">{{ value }}{{ unit }}</span>
    <button type="button" :class="STEPPER_BUTTON" :disabled="atMax" :aria-label="t('settings.stepper.increase', { label })" @click="emit('nudge', step)">
      +
    </button>
  </div>
</template>
