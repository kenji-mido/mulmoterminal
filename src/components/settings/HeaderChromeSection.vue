<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { headerButtonCount, headerChipCount } from "../../composables/headerConfigSummary";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import type { BundledSkillName } from "../../../common/bundledSkills";

// Read-only. A button carries a command, a run mode and a `when` scope, and a chip a template
// substituted with the session's live context — an editor for that is a small IDE, and the skill
// already asks the two questions ("what should it do", "where should it appear") that produce a
// correct entry.
//
// `null` is not zero: the key is unconfigured, so the built-in header applies. An empty array is a
// user who removed every button, and saying "0" for both would hide that difference.
defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();

// Three states, not a count: `null` is "the key is unconfigured, so the built-in header applies",
// and 0 is "a user removed every one" — saying "0" for both would hide that difference.
function describe(count: number | null, kind: "Buttons" | "Chips"): string {
  if (count === null) return t(`settings.headerChrome.builtIn${kind}`);
  if (count === 0) return t(`settings.headerChrome.no${kind}`);
  return t(`settings.headerChrome.some${kind}`, { count }, count);
}
</script>

<template>
  <i18n-t keypath="settings.headerChrome.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #buttons>
      <strong class="text-fg">{{ describe(headerButtonCount, "Buttons") }}</strong>
    </template>
    <template #chips>
      <strong class="text-fg">{{ describe(headerChipCount, "Chips") }}</strong>
    </template>
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
  <div class="mb-3">
    <SkillLaunchButton skill="mulmoterminal-header" icon="widgets" :label="t('settings.headerChrome.setUp')" @launch="$emit('launch-skill', $event)" />
  </div>
</template>
