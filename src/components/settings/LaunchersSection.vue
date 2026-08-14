<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddLauncher } from "../settingsValidators";
import type { Launcher } from "../launchers";
import SettingsListRow from "./SettingsListRow.vue";
import { SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ launchers?: Launcher[] | undefined }>();
const emit = defineEmits<{ (e: "update-launchers", launchers: Launcher[]): void }>();

const { t } = useI18n();

// Cell-launcher commands (label + command).
const { items: launcherList, replace } = useSavedListMirror<Launcher>(
  () => props.launchers,
  (next) => emit("update-launchers", next),
);

const newLauncherLabel = ref("");
const newLauncherCommand = ref("");
const newLauncherValid = computed(() => canAddLauncher(newLauncherLabel.value, newLauncherCommand.value, launcherList.value));
function addLauncher() {
  if (!newLauncherValid.value) return;
  replace([...launcherList.value, { label: newLauncherLabel.value.trim(), command: newLauncherCommand.value.trim() }]);
  newLauncherLabel.value = "";
  newLauncherCommand.value = "";
}
function removeLauncher(label: string) {
  replace(launcherList.value.filter((l) => l.label !== label));
}
</script>

<template>
  <!-- The examples are deliberately NOT an agent. A launcher runs its command verbatim and gets no
       GUI tools, no transcript, no resume and no "waiting for you" status, so a chip named after an
       agent is a worse copy of what the Agent Picker already offers — and offering one here is how
       people came to have both. Anything the Agent Picker cannot run is the real use for this. -->
  <i18n-t keypath="settings.launchers.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #labelExample><code>Dev</code></template>
    <template #commandExample><code>yarn dev</code></template>
  </i18n-t>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">{{ t("settings.launchers.notAnAgent") }}</p>
  <ul v-if="launcherList.length" :class="SETTINGS_LIST">
    <SettingsListRow v-for="l in launcherList" :key="l.label" :name="l.label" @remove="removeLauncher(l.label)">
      <span class="flex-auto font-mono text-[12px] text-secondary">{{ l.label }}</span>
      <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ l.command }}</code>
    </SettingsListRow>
  </ul>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="newLauncherLabel"
      class="min-w-0 shrink grow basis-[30%]"
      :placeholder="t('settings.launchers.labelPlaceholder')"
      :aria-label="t('settings.launchers.labelField')"
      spellcheck="false"
      @keydown.enter="addLauncher"
    />
    <SettingsField
      v-model="newLauncherCommand"
      class="min-w-0 flex-auto font-mono"
      :placeholder="t('settings.launchers.commandPlaceholder')"
      :aria-label="t('settings.launchers.commandField')"
      spellcheck="false"
      @keydown.enter="addLauncher"
    />
    <SettingsButton :disabled="!newLauncherValid" @click="addLauncher">{{ t("settings.common.add") }}</SettingsButton>
  </div>
</template>
