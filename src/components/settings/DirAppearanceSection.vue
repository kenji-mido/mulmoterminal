<script setup lang="ts">
import { useI18n } from "vue-i18n";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { autoDirIcon, saveAutoDirIcon } from "../../composables/autoDirIcon";
import type { BundledSkillName } from "../../../common/bundledSkills";

const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();

// The browser has already moved the checkbox by the time this runs, and a failed save leaves the
// ref where it was — so Vue sees no change to patch and the box keeps showing a value that was
// never stored. Putting it back is the only thing that says the save didn't happen (CodeRabbit
// on #1429). The six older toggles in Settings share this shape and this gap; fixing them is its
// own change, since it belongs in the shared helper rather than in one section.
async function onAutoIconToggle(e: Event): Promise<void> {
  if (!(e.target instanceof HTMLInputElement)) return;
  const input = e.target;
  if (!(await saveAutoDirIcon(input.checked))) input.checked = autoDirIcon.value;
}
</script>

<template>
  <i18n-t keypath="settings.dirAppearance.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #skill><code>mulmoterminal-dirs</code></template>
  </i18n-t>
  <SkillLaunchButton skill="mulmoterminal-dirs" icon="palette" :label="t('settings.dirAppearance.configure')" @launch="emit('launch-skill', $event)" />

  <!-- The off switch for a setting that is ON by default. Without it, turning the behaviour off
       would mean writing `"icon": false` into every project that happens to ship a favicon. -->
  <label class="mt-3 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      data-testid="auto-dir-icon"
      :checked="autoDirIcon"
      :aria-label="t('settings.dirAppearance.favicon')"
      @change="onAutoIconToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.dirAppearance.favicon") }}</strong> —
      <i18n-t keypath="settings.dirAppearance.faviconHint" tag="span">
        <template #iconKey><code>icon</code></template>
        <template #svg><code>public/favicon.svg</code></template>
        <template #png><code>apple-touch-icon.png</code></template>
        <template #iconFalse><code>"icon": false</code></template>
        <template #dirFile><code>.mulmoterminal.json</code></template>
      </i18n-t>
    </span>
  </label>
</template>
