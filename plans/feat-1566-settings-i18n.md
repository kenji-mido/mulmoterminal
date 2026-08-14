# feat(i18n): a Japanese Settings modal, and the host i18n it needs (#1566)

## Problem

MulmoTerminal has **no host i18n**. `vue-i18n` sits in `package.json` because the `@mulmoclaude/*`
plugins run their own, but `createI18n` / `useI18n` appear nowhere in `src/`, `server/` or `common/`,
and every UI string is hardcoded English.

#1563's report is someone who could not find the notification-sound setting. #1565 groups the
sections, which is half the answer; the other half is that a Japanese reader searching the screen for
「音」or「通知」finds no such word anywhere on it.

## Scope

**The Settings modal only** — `src/components/SettingsModal.vue` and `src/components/settings/*`.
Every other screen stays English and moves later, one surface at a time. The point of stopping here
is that the modal is the surface someone goes looking *in*, and it is the one #1563 named.

## Shape

### The runtime

- `src/i18n/index.ts` — `createI18n({ legacy: false, fallbackLocale: "en", messages: { en, ja } })`,
  installed in `src/main.ts`. `legacy: false` because the app is Composition API throughout.
- `src/i18n/en.ts`, `src/i18n/ja.ts` — one nested `settings` namespace each. English is the
  fallback, so a key missing from `ja` degrades to the English words rather than to the raw key.
- `src/composables/uiLanguage.ts` — a localStorage-backed singleton ref, `"auto" | "en" | "ja"`,
  the same shape `voiceLanguage.ts` already uses for the same kind of choice. `auto` resolves
  through the existing `browserLocale()` (`src/utils/browserLocale.ts`), which is already the app's
  one answer to "what language is this browser".

Per browser, not per host — like theme and font size, and unlike `fontFamily`. A phone and a desktop
can disagree about language, and nothing on the server needs to know.

### The tab table stops holding words

#1565 put every sidebar label in `settingsTabs.ts`. It now holds ids only, and the label is
`t('settings.tabs.' + id)` / `t('settings.groups.' + key)` — the same derivation MulmoClaude uses
(`t(\`settingsModal.tabs.${tabId}\`)`), so the two hosts' message trees read alike.

A spec pins that **every** id and group key has a message in **both** locales, enumerated from
`SETTINGS_GROUPS` rather than from a hand-written list — the lesson from #1104's guide renumbering
is that a check written from the same list as the thing it checks agrees with it.

### The sections

Each `*Section.vue` swaps its literals for `t()`. Prose carrying inline `<code>` / `<strong>` /
links uses `<i18n-t>` with named slots rather than being split into fragments, so a translator sees
one sentence and the word order can differ between languages.

`aria-label`s are translated too — they are what a screen reader says, so leaving them English is
leaving the screen half-translated.

### Tests

`test/setup-i18n.ts`, added to `vitest.config.ts`'s `setupFiles`, installs the i18n plugin into
`@vue/test-utils`' `config.global.plugins` with the locale pinned to **`en`**. Every existing spec
then keeps working untouched, and the English `aria-label` selectors they already query by stay
correct. A spec that wants Japanese sets the locale itself.

## Out of scope

Every screen but this one; server-side messages; the bundled skills' text; `docs/`.

## Depends on

#1565 (`settingsTabs.ts` is where the labels were gathered). Branched from it; `origin/main` gets
merged in once that lands.
