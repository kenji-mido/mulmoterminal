<script setup lang="ts">
import { useTerminalScrollSpeed } from "../../composables/useTerminalScrollSpeed";
import SettingsStepper from "./SettingsStepper.vue";
import { SECTION_HEADING } from "./sectionClasses";

// Same shape and the same per-browser reasoning as the font size: it is a property of the
// pointing device, and a trackpad and a wheel mouse want different answers.
const { scrollSpeed, nudgeScrollSpeed, min, max, step } = useTerminalScrollSpeed();
</script>

<template>
  <h3 :class="SECTION_HEADING">Terminal scroll speed</h3>
  <SettingsStepper :value="scrollSpeed" unit="×" :min="min" :max="max" :step="step" label="terminal scroll speed" @nudge="nudgeScrollSpeed" />
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    How far one wheel notch or trackpad swipe moves the terminal — 1× is the default. Lower it if a two-finger scroll on a Mac trackpad flies past what you were
    reading. Per browser, and it covers both a shell's scrollback and a full-screen app like Claude Code.
  </p>
</template>
