import { beforeEach } from "vitest";

// Every jsdom mount gets the i18n plugin, so a spec that mounts a translated component does not have
// to know it is translated. Installed globally rather than per file for the reason the app installs
// it globally: `useI18n()` throws without it, and which components call it is not a spec's business.
//
// Imported dynamically behind the window check because setupFiles run for EVERY environment, and the
// specs marked `@vitest-environment node` have no `localStorage` — which `uiLanguage` reads at module
// scope. A static import would throw there, before any guard in this file could run.
if (typeof window !== "undefined") {
  const { config } = await import("@vue/test-utils");
  const { i18n } = await import("../src/i18n");
  const { uiLanguage } = await import("../src/composables/uiLanguage");
  config.global.plugins.push(i18n);

  // Pinned to English, and re-pinned between tests. The specs select controls by their English
  // `aria-label` — those are translated strings now — so a test that switches locale must not leave
  // the next one reading Japanese.
  beforeEach(() => {
    uiLanguage.value = "en";
    i18n.global.locale.value = "en";
  });
}
