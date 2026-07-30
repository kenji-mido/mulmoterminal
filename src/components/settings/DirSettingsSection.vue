<script setup lang="ts">
import DirConfigPreview from "../DirConfigPreview.vue";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SECTION_HEADING } from "./sectionClasses";
import type { BundledSkillName } from "../../../common/bundledSkills";

defineProps<{ dirPaths?: string[] | undefined }>();
const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();
</script>

<template>
  <h3 :class="SECTION_HEADING">Directory settings</h3>
  <p class="mb-1 mt-1.5 text-[12px] text-dim">
    What each directory's <code>.mulmoterminal.json</code> is actually doing. Expand one to see the values in force, and any key the app dropped or doesn't
    recognise — a setting that never took effect looks the same as one you never made until you can see this.
  </p>
  <DirConfigPreview :paths="dirPaths ?? []" />
  <p class="mb-3 mt-2.5 text-[12px] text-dim">
    This lists what is wrong; the skill reads the same thing and says why, then fixes it or points you at whichever skill owns that key.
  </p>
  <SkillLaunchButton skill="mulmoterminal-config" icon="troubleshoot" label="Explain my settings…" @launch="emit('launch-skill', $event)" />
</template>
