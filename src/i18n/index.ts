import { watch } from "vue";
import { createI18n } from "vue-i18n";
import { en } from "./en";
import { ja } from "./ja";
import { resolveUiLocale, uiLanguage } from "../composables/uiLanguage";

// `legacy: false` — the app is Composition API throughout, and the legacy mode installs a global
// mixin that would put `$t` on every component in the tree, including the plugin roots.
//
// English is the fallback, so a key a translation has not caught up with renders the English words
// rather than the key. The type in ./messages makes that state a compile error, not a habit.
export const i18n = createI18n({
  legacy: false,
  locale: resolveUiLocale(uiLanguage.value),
  fallbackLocale: "en",
  messages: { en, ja },
});

// The setting is the source of truth; this keeps the runtime following it. Watched here rather than
// written from the picker so any other writer of `uiLanguage` reaches the same place.
watch(uiLanguage, (language) => {
  i18n.global.locale.value = resolveUiLocale(language);
});
