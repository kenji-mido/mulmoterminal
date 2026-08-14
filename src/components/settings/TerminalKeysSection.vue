<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { copyOnSelect, saveCopyOnSelect } from "../../composables/copyOnSelect";
import { terminalSubmitMode, saveTerminalSubmitMode } from "../../composables/terminalSubmitMode";
import { TERMINAL_SUBMIT_MODES, isTerminalSubmitMode } from "../../../common/terminalSubmit";

// The two key-behaviour settings that are a single value each, so they get a control here rather
// than the skill the keymap needs. The keymap itself stays read-only in KeyboardShortcutsSection:
// a binding takes its key away from the program inside the terminal, which is a question about the
// user's agent, not a toggle.
const { t } = useI18n();

function onCopyOnSelectToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveCopyOnSelect(e.target.checked);
}

function onSubmitModeChange(e: Event) {
  if (e.target instanceof HTMLSelectElement && isTerminalSubmitMode(e.target.value)) void saveTerminalSubmitMode(e.target.value);
}
</script>

<template>
  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="copyOnSelect"
      :aria-label="t('settings.terminalKeys.copyOnSelect')"
      @change="onCopyOnSelectToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.terminalKeys.copyOnSelectTitle") }}</strong> — {{ t("settings.terminalKeys.copyOnSelectHint") }}
    </span>
  </label>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settings.terminalKeys.enterTitle") }}</strong> — {{ t("settings.terminalKeys.enterHint") }}
  </p>
  <select
    class="mb-1 w-full cursor-pointer rounded-lg border border-border bg-elevated px-2 py-1.5 text-[12px] text-fg"
    :value="terminalSubmitMode"
    :aria-label="t('settings.terminalKeys.enterField')"
    @change="onSubmitModeChange"
  >
    <option v-for="mode in TERMINAL_SUBMIT_MODES" :key="mode" :value="mode">{{ t(`settings.terminalKeys.modes.${mode}`) }}</option>
  </select>
</template>
