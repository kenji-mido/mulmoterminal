<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { VOICE_LANGUAGES, voiceLanguage } from "../../composables/voiceLanguage";
import { SELECT_CONTROL } from "../selectClasses";

const { t } = useI18n();

// Voice input's language mode. The setting is a singleton ref (localStorage-backed), so it needs no
// prop/emit plumbing.
//
// Whether the machine can transcribe at all is asked by the MODAL, not here: capability decides
// whether the sidebar offers this tab, and a section that hid itself inside a tab of its own would
// leave an empty pane behind the button.
</script>

<template>
  <i18n-t keypath="settings.voice.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #translated>
      <strong>{{ t("settings.voice.translated") }}</strong>
    </template>
  </i18n-t>
  <select v-model="voiceLanguage" :aria-label="t('settings.voice.picker')" :class="SELECT_CONTROL">
    <option value="locale">{{ t("settings.voice.browserLanguage") }}</option>
    <option value="auto">{{ t("settings.voice.detect") }}</option>
    <optgroup :label="t('settings.voice.always')">
      <option v-for="lang in VOICE_LANGUAGES" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
    </optgroup>
  </select>
</template>
