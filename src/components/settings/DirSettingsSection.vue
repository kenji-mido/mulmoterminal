<script setup lang="ts">
import { useI18n } from "vue-i18n";
import DirConfigPreview from "../DirConfigPreview.vue";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import type { BundledSkillName } from "../../../common/bundledSkills";

defineProps<{ dirPaths?: string[] | undefined }>();
const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();
</script>

<template>
  <i18n-t keypath="settings.dirSettings.intro" tag="p" class="mb-1 mt-1.5 text-[12px] text-dim">
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
  <DirConfigPreview :paths="dirPaths ?? []" />
  <p class="mb-3 mt-2.5 text-[12px] text-dim">{{ t("settings.dirSettings.outro") }}</p>
  <SkillLaunchButton skill="mulmoterminal-config" icon="troubleshoot" :label="t('settings.dirSettings.explain')" @launch="emit('launch-skill', $event)" />
</template>
