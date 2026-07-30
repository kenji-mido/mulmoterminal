<script setup lang="ts">
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SECTION_HEADING } from "./sectionClasses";
import type { BundledSkillName } from "../../../common/bundledSkills";

const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();
</script>

<template>
  <h3 :class="SECTION_HEADING">Directory appearance</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Launch the <code>mulmoterminal-dirs</code> skill to style and order your directories — name badge, colors, terminal palette, grid position. It starts from
    the directories you actually open, reads the settings you already have, and follows the same pattern for the ones that have none.
  </p>
  <SkillLaunchButton skill="mulmoterminal-dirs" icon="palette" label="Configure appearance…" @launch="emit('launch-skill', $event)" />
</template>
