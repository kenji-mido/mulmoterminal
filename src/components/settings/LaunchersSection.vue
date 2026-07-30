<script setup lang="ts">
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddLauncher } from "../settingsValidators";
import type { Launcher } from "../launchers";
import SettingsListRow from "./SettingsListRow.vue";
import { SECTION_HEADING, SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ launchers?: Launcher[] | undefined }>();
const emit = defineEmits<{ (e: "update-launchers", launchers: Launcher[]): void }>();

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
  <h3 :class="SECTION_HEADING">Launch commands</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Programs a grid cell can launch besides Claude — a plain shell, <code>codex</code>, any interactive command. They run in the cell's directory as a
    persistent terminal. Example: <code>Shell</code> → <code>$SHELL</code>, <code>Codex</code> → <code>codex</code>.
  </p>
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
      placeholder="Label"
      aria-label="Launcher label"
      spellcheck="false"
      @keydown.enter="addLauncher"
    />
    <SettingsField
      v-model="newLauncherCommand"
      class="min-w-0 flex-auto font-mono"
      placeholder="command (e.g. $SHELL)"
      aria-label="Launcher command"
      spellcheck="false"
      @keydown.enter="addLauncher"
    />
    <SettingsButton :disabled="!newLauncherValid" @click="addLauncher">Add</SettingsButton>
  </div>
</template>
