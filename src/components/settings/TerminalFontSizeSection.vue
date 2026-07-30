<script setup lang="ts">
import { useTerminalFontSize } from "../../composables/useTerminalFontSize";
import SettingsStepper from "./SettingsStepper.vue";
import { SECTION_HEADING } from "./sectionClasses";

// Applied immediately (like the theme). Per-browser, so a phone and a desktop on the same server
// keep their own; a directory can pin its own in .mulmoterminal.json.
const { fontSize, nudgeFontSize, min, max, step } = useTerminalFontSize();
</script>

<template>
  <h3 :class="SECTION_HEADING">Terminal font size</h3>
  <SettingsStepper :value="fontSize" :unit="' px'" :min="min" :max="max" :step="step" label="terminal font size" @nudge="nudgeFontSize" />
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Applies to every terminal on this browser. A directory can pin its own with <code>fontSize</code> in its <code>.mulmoterminal.json</code>.
  </p>
</template>
