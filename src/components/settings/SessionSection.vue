<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { appendSystemPrompt, saveAppendSystemPrompt } from "../../composables/appendSystemPrompt";
import { decisionDigest, saveDecisionDigest } from "../../composables/decisionDigest";
import { worklogEnabled, saveWorklogEnabled, worklogIntervalHours, saveWorklogIntervalHours } from "../../composables/worklog";
import { MIN_WORKLOG_INTERVAL_HOURS, MAX_WORKLOG_INTERVAL_HOURS } from "../../../common/worklogInterval";
import SettingsStepper from "./SettingsStepper.vue";

// What a spawned session carries, and what runs on its own in the background. All three are
// global config keys the server acts on — this browser only shows and writes them.
const { t } = useI18n();

const WORKLOG_STEP_HOURS = 1;

function onAppendToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveAppendSystemPrompt(e.target.checked);
}
function onDigestToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveDecisionDigest(e.target.checked);
}
function onWorklogToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveWorklogEnabled(e.target.checked);
}
function nudgeInterval(delta: number) {
  void saveWorklogIntervalHours(worklogIntervalHours.value + delta);
}
</script>

<template>
  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input type="checkbox" class="mt-1 cursor-pointer" :checked="appendSystemPrompt" :aria-label="t('settings.sessions.summary')" @change="onAppendToggle" />
    <span class="text-[12px]">
      <strong>{{ t("settings.sessions.summary") }}</strong> —
      <i18n-t keypath="settings.sessions.summaryHint" tag="span">
        <template #dirFile><code>.mulmoterminal.json</code></template>
      </i18n-t>
    </span>
  </label>

  <label class="mt-2 flex cursor-pointer items-start gap-2">
    <input type="checkbox" class="mt-1 cursor-pointer" :checked="decisionDigest" :aria-label="t('settings.sessions.digest')" @change="onDigestToggle" />
    <span class="text-[12px]">
      <strong>{{ t("settings.sessions.digestTitle") }}</strong> —
      <i18n-t keypath="settings.sessions.digestHint" tag="span">
        <template #dir><code>~/.mulmoterminal/decisions/</code></template>
      </i18n-t>
    </span>
  </label>

  <label class="mt-2 flex cursor-pointer items-start gap-2">
    <input type="checkbox" class="mt-1 cursor-pointer" :checked="worklogEnabled" :aria-label="t('settings.sessions.worklog')" @change="onWorklogToggle" />
    <span class="text-[12px]">
      <strong>{{ t("settings.sessions.worklog") }}</strong> — {{ t("settings.sessions.worklogHint") }}
    </span>
  </label>
  <div class="mb-3 mt-2" :class="worklogEnabled ? '' : 'pointer-events-none opacity-50'">
    <p class="mb-1.5 text-[12px] text-dim">{{ t("settings.sessions.worklogInterval") }}</p>
    <SettingsStepper
      :value="worklogIntervalHours"
      :unit="' h'"
      :min="MIN_WORKLOG_INTERVAL_HOURS"
      :max="MAX_WORKLOG_INTERVAL_HOURS"
      :step="WORKLOG_STEP_HOURS"
      :label="t('settings.sessions.worklogStepper')"
      :disabled="!worklogEnabled"
      @nudge="nudgeInterval"
    />
  </div>
</template>
