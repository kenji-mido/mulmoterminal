import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsModal from "../../../../src/components/SettingsModal.vue";
import LanguageSection from "../../../../src/components/settings/LanguageSection.vue";
import { i18n } from "../../../../src/i18n";
import { en } from "../../../../src/i18n/en";
import { ja } from "../../../../src/i18n/ja";
import { UI_LANGUAGE_AUTO, parseUiLanguage, resolveUiLocale, uiLanguage } from "../../../../src/composables/uiLanguage";

// The picker writes `uiLanguage`, and the runtime follows it — the modal must not be reading the
// setting a second way, or a language change would move some of the screen and not the rest.
describe("Settings language picker", () => {
  afterEach(() => {
    uiLanguage.value = "en";
    vi.unstubAllGlobals();
  });

  it("switches the whole modal, sidebar included, when a language is picked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const w = mount(SettingsModal);
    await flushPromises();
    expect(w.get('[data-testid="settings-tab-sounds"]').text()).toBe(en.settings.tabs.sounds);
    expect(w.get('[data-testid="settings-pane"]').text()).toContain(en.settings.tabs.theme);

    await mount(LanguageSection).get("select").setValue("ja");
    await flushPromises();
    expect(w.get('[data-testid="settings-tab-sounds"]').text()).toBe(ja.settings.tabs.sounds);
    expect(w.get('[data-testid="settings-pane"]').text()).toContain(ja.settings.tabs.theme);
  });

  it("persists the pick, and reads back only a language it has a bundle for", async () => {
    await mount(LanguageSection).get("select").setValue("ja");
    expect(localStorage.getItem("ui_language")).toBe("ja");
    expect(parseUiLanguage("ja")).toBe("ja");
    // A bundle that has since been removed, or a hand-edited value, must not reach vue-i18n —
    // there it would resolve to no messages at all rather than to English.
    expect(parseUiLanguage("kl")).toBe(UI_LANGUAGE_AUTO);
    expect(parseUiLanguage(null)).toBe(UI_LANGUAGE_AUTO);
  });

  // `auto` is the default, and it has to survive a browser the app has no bundle for.
  it.each([
    ["ja-JP", "ja"],
    ["ja", "ja"],
    ["en-GB", "en"],
    ["kl-GL", "en"],
  ])("resolves auto on a %s browser to %s", (language, expected) => {
    vi.stubGlobal("navigator", { language });
    expect(resolveUiLocale(UI_LANGUAGE_AUTO)).toBe(expected);
  });

  it("says what auto currently resolves to, rather than leaving it to be guessed", async () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    uiLanguage.value = UI_LANGUAGE_AUTO;
    const w = mount(LanguageSection);
    await flushPromises();
    // The bare subtag, not `ja-JP`: `browserLocale()` drops the region on purpose (en-GB and en-US
    // want one bundle), and this line has to say the value the app actually resolved.
    expect(w.text()).toContain("ja");
    expect(w.text()).toContain("日本語");
  });

  // English is the fallback, so an untranslated key renders English words. That is only true while
  // `ja` is complete — the moment it isn't, half a pane silently reverts and nothing fails.
  it("translates every key the English bundle declares", () => {
    const missing: string[] = [];
    const walk = (english: unknown, path: string) => {
      if (typeof english === "string") {
        if (!i18n.global.te(path, "ja")) missing.push(path);
        return;
      }
      if (english && typeof english === "object") {
        Object.entries(english).forEach(([key, value]) => walk(value, `${path}${path ? "." : ""}${key}`));
      }
    };
    walk(en, "");
    expect(missing).toEqual([]);
  });
});
