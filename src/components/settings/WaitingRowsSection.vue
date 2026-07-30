<script setup lang="ts">
import { useRosterAlert } from "../../composables/useRosterAlert";
import { SECTION_HEADING } from "./sectionClasses";

// Whether a roster row waiting on the user blinks (#1131) — per browser for the same reason the
// sizes above are: it is the person watching the screen who finds movement useful or distracting,
// not the host.
const { blink: rosterBlink, setBlink: setRosterBlink } = useRosterAlert();
function onRosterBlinkToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) setRosterBlink(e.target.checked);
}
</script>

<template>
  <h3 :class="SECTION_HEADING">Waiting rows</h3>
  <p class="mb-2 mt-1.5 text-[12px] text-dim">
    In the list beside an enlarged cell, a row whose agent is <strong>waiting on you</strong> — a permission prompt, a question — carries an amber ring and
    blinks. A row that has simply <strong>finished</strong> is green and holds still. Turning this off keeps both colours and stops the movement; rows never
    blink when your system asks for reduced motion.
  </p>
  <label class="mb-3 flex cursor-pointer items-center gap-2">
    <input type="checkbox" class="cursor-pointer" :checked="rosterBlink" aria-label="Blink a row that is waiting on me" @change="onRosterBlinkToggle" />
    <span class="text-[13px]">Blink a row that is waiting on me</span>
  </label>
</template>
