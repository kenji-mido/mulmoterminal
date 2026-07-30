<script setup lang="ts">
// A Settings button that hands the section over to the skill which owns that setting.
//
// `skill` is typed rather than a free string on purpose: a slug that names no shipped skill
// fails nothing anywhere — typecheck, lint and the specs all pass, and the only symptom is the
// launched agent replying that it can't find it, in a session the user has to read to notice.
// `BundledSkillName` moves that to the moment it is written.
import SettingsButton from "./SettingsButton.vue";
import type { BundledSkillName } from "../../common/bundledSkills";

defineProps<{ skill: BundledSkillName; icon: string; label: string }>();
const emit = defineEmits<{ (e: "launch", skill: BundledSkillName): void }>();
</script>

<template>
  <SettingsButton @click="emit('launch', skill)">
    <span class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span> {{ label }}
  </SettingsButton>
</template>
