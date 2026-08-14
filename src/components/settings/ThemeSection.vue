<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useTheme } from "../../composables/useTheme";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import type { BundledSkillName } from "../../../common/bundledSkills";

const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();

// Theme is applied immediately on click.
const { themeId, themes, setTheme, missingThemeId } = useTheme();
const themesEl = ref<HTMLElement>();

// ARIA radiogroup keyboard contract: arrows move selection (and focus) within
// the group, wrapping at the ends; only the checked radio is tabbable (roving
// tabindex), so Tab enters/leaves the group as one stop.
// Roving tabindex, with a floor: when the selection names a theme that isn't in the list — the
// missing-theme case this build added (#996) — nothing matches and EVERY option would be
// tabindex="-1", so a keyboard user could not reach the picker at all while the notice above it
// says to pick one. The first option becomes the tab stop in that state.
const hasSelectedTheme = computed(() => themes.value.some((t) => t.id === themeId.value));
function isThemeTabStop(id: string, index: number): boolean {
  return hasSelectedTheme.value ? themeId.value === id : index === 0;
}

function onThemeKey(e: KeyboardEvent, index: number) {
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
  if (!forward && !backward) return;
  e.preventDefault();
  const next = (index + (forward ? 1 : themes.value.length - 1)) % themes.value.length;
  const target = themes.value[next];
  if (!target) return;
  setTheme(target.id);
  themesEl.value?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}
</script>

<template>
  <i18n-t
    v-if="missingThemeId"
    keypath="settings.theme.missing"
    tag="p"
    class="mb-2 mt-1.5 text-[12px] text-[var(--warn-text,#e0a030)]"
    data-testid="theme-missing"
  >
    <template #id
      ><code>{{ missingThemeId }}</code></template
    >
    <template #themesKey><code>themes</code></template>
    <template #configFile><code>~/.mulmoterminal/config.json</code></template>
  </i18n-t>
  <i18n-t keypath="settings.theme.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #themesKey><code>themes</code></template>
    <template #configFile><code>~/.mulmoterminal/config.json</code></template>
  </i18n-t>
  <div ref="themesEl" class="flex flex-wrap gap-2" role="radiogroup" :aria-label="t('settings.theme.group')">
    <button
      v-for="(scheme, i) in themes"
      :key="scheme.id"
      type="button"
      class="flex w-[84px] cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-elevated p-2 hover:bg-hover"
      :class="themeId === scheme.id ? 'border-accent text-fg' : 'border-border text-muted hover:text-fg'"
      role="radio"
      :aria-checked="themeId === scheme.id"
      :tabindex="isThemeTabStop(scheme.id, i) ? 0 : -1"
      :title="scheme.label"
      @click="setTheme(scheme.id)"
      @keydown="onThemeKey($event, i)"
    >
      <span class="relative h-[34px] w-full overflow-hidden rounded-md border border-border" :style="{ background: scheme.swatch.base }">
        <span class="absolute bottom-1.5 left-2 h-3 w-3 rounded-full" :style="{ background: scheme.swatch.panel }" />
        <span class="absolute bottom-1.5 left-6 h-3 w-3 rounded-full" :style="{ background: scheme.swatch.accent }" />
      </span>
      <span class="text-[12px]">{{ scheme.label }}</span>
    </button>
  </div>
  <div class="mt-3">
    <SkillLaunchButton skill="mulmoterminal-theme" icon="format_paint" :label="t('settings.theme.create')" @launch="emit('launch-skill', $event)" />
  </div>
</template>
