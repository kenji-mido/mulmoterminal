<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { UI_LANGUAGE_AUTO, UI_LOCALES, resolveUiLocale, uiLanguage } from "../../composables/uiLanguage";
import { browserLocale } from "../../utils/browserLocale";
import { SELECT_CONTROL } from "../selectClasses";

const { t } = useI18n();

// What `auto` currently resolves to, spelled out: the picker otherwise says "my browser's language"
// and leaves the reader to guess whether this browser is one the app has a bundle for.
const resolvedLabel = computed(() => UI_LOCALES.find((locale) => locale.code === resolveUiLocale(uiLanguage.value))?.label ?? "");
</script>

<template>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">{{ t("settings.language.intro") }}</p>
  <select v-model="uiLanguage" :aria-label="t('settings.language.picker')" :class="SELECT_CONTROL">
    <option :value="UI_LANGUAGE_AUTO">{{ t("settings.language.auto") }}</option>
    <option v-for="locale in UI_LOCALES" :key="locale.code" :value="locale.code">{{ locale.label }}</option>
  </select>
  <p v-if="uiLanguage === UI_LANGUAGE_AUTO" class="mt-1.5 text-[12px] text-muted">
    {{ t("settings.language.autoResolved", { locale: browserLocale(), label: resolvedLabel }) }}
  </p>
  <p class="mt-3 text-[12px] text-muted">{{ t("settings.language.partial") }}</p>
</template>
