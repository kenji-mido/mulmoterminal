<script setup lang="ts">
import { onMounted, ref } from "vue";
import { VOICE_LANGUAGES, voiceLanguage } from "../../composables/voiceLanguage";
import { fetchVoiceInputStatus } from "../../composables/voiceModelStatus";
import { SELECT_CONTROL } from "../selectClasses";
import { SECTION_HEADING } from "./sectionClasses";

// Voice input's language mode. The setting is a singleton ref (localStorage-backed), so it
// needs no prop/emit plumbing — but the section is only worth showing on a machine that can
// transcribe at all, and capability lives on the server. One cheap GET when the modal opens;
// a failed/absent probe leaves the section hidden rather than offering a setting for a mic
// that will never appear.
const voiceCapable = ref(false);
async function refreshVoiceCapable() {
  voiceCapable.value = (await fetchVoiceInputStatus())?.capable ?? false;
}
onMounted(() => void refreshVoiceCapable());
</script>

<template>
  <template v-if="voiceCapable">
    <h3 :class="SECTION_HEADING">Voice input</h3>
    <p class="mb-3 mt-1.5 text-[12px] text-dim">
      The language you dictate in. Speaking a language the mic is not expecting comes back <strong>translated</strong> into the expected one — so pick the one
      you actually speak rather than leaving it on your browser's.
    </p>
    <select v-model="voiceLanguage" aria-label="Language for voice input" :class="SELECT_CONTROL">
      <option value="locale">My browser's language</option>
      <option value="auto">Detect from what I say</option>
      <optgroup label="Always this language">
        <option v-for="lang in VOICE_LANGUAGES" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
      </optgroup>
    </select>
  </template>
</template>
