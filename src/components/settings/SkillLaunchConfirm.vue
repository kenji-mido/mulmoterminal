<script setup lang="ts">
// What a skill button actually does, said before it does it (#1564).
//
// Pressing one used to close Settings, spawn an agent in a new cell and send the first turn — all
// without a word on screen, and with no way back that anything named. This asks first.
//
// It binds no keyboard of its own: Escape and Tab belong to SettingsModal, which owns whether this
// is open. Two `document` Escape listeners would close the confirm AND the modal behind it on one
// press, which is the failure this dialog exists to avoid a version of.
import { useI18n } from "vue-i18n";
import SettingsButton from "../SettingsButton.vue";
import type { TerminalAgent } from "../../../common/sessionAgent";

defineProps<{ agent: TerminalAgent }>();
const emit = defineEmits<{ (e: "confirm" | "cancel"): void }>();

const { t } = useI18n();
</script>

<template>
  <div class="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(0,0,0,0.55)] p-4" data-testid="skill-launch-confirm" @click.self="emit('cancel')">
    <div
      class="flex w-[min(420px,94vw)] flex-col gap-3 rounded-[10px] border border-border bg-base p-4 font-sans text-fg"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.skillConfirm.title')"
    >
      <h3 class="m-0 text-[14px] font-semibold">{{ t("settings.skillConfirm.title") }}</h3>
      <p class="m-0 text-[12px] text-dim">{{ t("settings.skillConfirm.what", { agent }) }}</p>
      <p class="m-0 text-[12px] text-dim">{{ t("settings.skillConfirm.howToStop") }}</p>
      <div class="mt-1 flex items-center justify-end gap-2">
        <!-- Cancel first: the safe answer should not be the one already under the pointer. -->
        <SettingsButton data-testid="skill-launch-cancel" @click="emit('cancel')">{{ t("settings.skillConfirm.cancel") }}</SettingsButton>
        <SettingsButton primary data-testid="skill-launch-start" @click="emit('confirm')">{{ t("settings.skillConfirm.start") }}</SettingsButton>
      </div>
    </div>
  </div>
</template>
