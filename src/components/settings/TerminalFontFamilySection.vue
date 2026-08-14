<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { configuredFontFamily, saveGlobalFontFamily } from "../../composables/terminalFontFamily";
import { normalizeFontFamily, TERMINAL_FONT_FAMILY_DEFAULT } from "../../../common/terminalFontFamily";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";

const { t } = useI18n();

// Global, unlike the font SIZE above it: a family names FONTS, and which fonts exist belongs to
// the machine the browser runs on, so it is one answer for every client of one host.
//
// An editable mirror rather than a bound ref, like the list sections: typing a stack character by
// character must not POST on every keystroke, and a half-typed family name is not a stack.
//
// The saved value is adopted only while the box is UNTOUCHED. /api/config is fetched
// asynchronously, so the modal can open before it lands — and a plain watch would then wipe out
// whatever the user had begun typing in the meantime, with no way to get it back. After a save the
// draft matches what was saved, which counts as untouched again, so the server's normalized answer
// (a `monospace` it appended) still lands in the box.
const draft = ref(configuredFontFamily.value ?? "");
const edited = ref(false);
watch(configuredFontFamily, (value) => {
  if (!edited.value) draft.value = value ?? "";
});

// Judged with the SAME function the server sanitizes with, the way the list sections judge a repo
// or an MCP server. Without it this field silently eats the input: an unusable stack normalizes to
// null, which saves as "use the built-in", and when nothing was configured before, the saved value
// does not change — so the watch never fires, the text stays in the box, and pressing Apply again
// does nothing and says nothing. Blank is not invalid; it is how you ask for the built-in stack.
const trimmed = computed(() => draft.value.trim());
const usable = computed(() => trimmed.value === "" || normalizeFontFamily(trimmed.value) !== null);
const unchanged = computed(() => trimmed.value === (configuredFontFamily.value ?? ""));

// Explicit rather than a fallthrough `@input`, so what marks the box as touched is the same event
// that changes the draft — a listener that merely rides along on the root element is easy to lose
// in a refactor of SettingsField.
function onType(value: string) {
  draft.value = value;
  edited.value = true;
}

const saving = ref(false);
async function apply() {
  if (!usable.value || unchanged.value) return;
  saving.value = true;
  // Blank means "use the built-in" — the saver maps it to null rather than to an empty stack.
  const saved = await saveGlobalFontFamily(trimmed.value || null);
  // ONLY on success. The box is what the user typed, and a failed POST is the moment they most
  // need it kept — resetting there would throw the stack away over a dropped request and leave
  // them nothing to retry with (Codex review on #1416).
  if (saved) {
    // Saved is untouched again: the server's normalized answer lands in the box, and the next
    // config load has nothing of the user's left to overwrite.
    edited.value = false;
    draft.value = configuredFontFamily.value ?? "";
  }
  saving.value = false;
}
</script>

<template>
  <i18n-t keypath="settings.font.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #key><code>fontFamily</code></template>
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
  <div class="flex items-center gap-2">
    <SettingsField
      :model-value="draft"
      class="flex-auto font-mono"
      :placeholder="TERMINAL_FONT_FAMILY_DEFAULT"
      :aria-label="t('settings.font.field')"
      spellcheck="false"
      @update:model-value="onType"
      @keydown.enter="apply"
    />
    <SettingsButton :disabled="saving || unchanged || !usable" @click="apply">{{ t("settings.font.apply") }}</SettingsButton>
  </div>
  <i18n-t v-if="!usable" keypath="settings.font.invalid" tag="p" class="mb-3 mt-1.5 text-[12px] text-err-text">
    <template #example><code>'Cica', 'MS Gothic', monospace</code></template>
  </i18n-t>
  <i18n-t v-else keypath="settings.font.hint" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #mono><code>monospace</code></template>
  </i18n-t>
</template>
