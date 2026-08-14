import { ref, watch } from "vue";
import { browserLocale } from "../utils/browserLocale";

// Which language the app's own chrome is written in.
//
//   auto     — the browser's, when there is a bundle for it (the default)
//   <code>   — the one you picked, whatever the browser is set to
//
// Per browser (localStorage), like the theme and the terminal font size, and unlike `fontFamily`:
// a phone and a desktop can want different languages, and nothing on the server reads this.
const STORAGE_KEY = "ui_language";

export const UI_LANGUAGE_AUTO = "auto";

/** The bundles that exist. Adding one here is not enough — it needs messages under the same code
 *  in `src/i18n`, which is what the type on `ja` enforces. */
export const UI_LOCALES = [
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
] as const;

export type UiLocale = (typeof UI_LOCALES)[number]["code"];
export type UiLanguage = typeof UI_LANGUAGE_AUTO | UiLocale;

export const isUiLocale = (raw: string): raw is UiLocale => UI_LOCALES.some((locale) => locale.code === raw);

/** Anything else on disk — a bundle that has since been removed, a hand-edited value — reads as
 *  `auto` rather than being handed to vue-i18n, where it would resolve to no messages at all. */
export const parseUiLanguage = (raw: string | null): UiLanguage => (raw && isUiLocale(raw) ? raw : UI_LANGUAGE_AUTO);

export const uiLanguage = ref<UiLanguage>(parseUiLanguage(localStorage.getItem(STORAGE_KEY)));
watch(uiLanguage, (language) => localStorage.setItem(STORAGE_KEY, language));

/** What to actually render in. `browserLocale()` is the app's one answer to "what language is this
 *  browser" (region already dropped, so `ja-JP` and `ja` agree); a browser we have no bundle for
 *  falls back to English rather than to keys. */
export function resolveUiLocale(language: UiLanguage): UiLocale {
  if (language !== UI_LANGUAGE_AUTO) return language;
  const browser = browserLocale();
  return isUiLocale(browser) ? browser : "en";
}
