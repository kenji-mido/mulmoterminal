<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useTerminalScrollSpeed } from "../../composables/useTerminalScrollSpeed";
import { useScrollToBottomOnSubmit } from "../../composables/useScrollToBottomOnSubmit";
import SettingsStepper from "./SettingsStepper.vue";

// Same shape and the same per-browser reasoning as the font size: it is a property of the
// pointing device, and a trackpad and a wheel mouse want different answers.
const { t } = useI18n();
const { scrollSpeed, nudgeScrollSpeed, min, max, step } = useTerminalScrollSpeed();
const { scrollToBottomOnSubmit, setScrollToBottomOnSubmit } = useScrollToBottomOnSubmit();
function onReturnToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) setScrollToBottomOnSubmit(e.target.checked);
}
</script>

<template>
  <SettingsStepper :value="scrollSpeed" unit="×" :min="min" :max="max" :step="step" :label="t('settings.scroll.stepper')" @nudge="nudgeScrollSpeed" />
  <p class="mb-3 mt-1.5 text-[12px] text-dim">{{ t("settings.scroll.hint") }}</p>

  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="scrollToBottomOnSubmit"
      :aria-label="t('settings.scroll.returnLabel')"
      @change="onReturnToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.scroll.returnLabel") }}</strong> — {{ t("settings.scroll.returnHint") }}
    </span>
  </label>
</template>
