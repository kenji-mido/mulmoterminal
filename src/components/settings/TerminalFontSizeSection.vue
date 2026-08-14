<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useTerminalFontSize } from "../../composables/useTerminalFontSize";
import SettingsStepper from "./SettingsStepper.vue";

// Applied immediately (like the theme). Per-browser, so a phone and a desktop on the same server
// keep their own; a directory can pin its own in .mulmoterminal.json.
const { t } = useI18n();
const { fontSize, nudgeFontSize, min, max, step } = useTerminalFontSize();
</script>

<template>
  <SettingsStepper :value="fontSize" :unit="' px'" :min="min" :max="max" :step="step" :label="t('settings.fontSize.stepper')" @nudge="nudgeFontSize" />
  <i18n-t keypath="settings.fontSize.hint" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #key><code>fontSize</code></template>
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
</template>
