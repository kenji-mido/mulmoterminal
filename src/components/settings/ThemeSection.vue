<script setup lang="ts">
import { computed, ref } from "vue";
import { useTheme } from "../../composables/useTheme";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SECTION_HEADING } from "./sectionClasses";
import type { BundledSkillName } from "../../../common/bundledSkills";

const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

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
  setTheme(themes.value[next].id);
  themesEl.value?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}
</script>

<template>
  <h3 :class="SECTION_HEADING">Theme</h3>
  <p v-if="missingThemeId" class="mb-2 mt-1.5 text-[12px] text-[var(--warn-text,#e0a030)]" data-testid="theme-missing">
    The selected theme <code>{{ missingThemeId }}</code> is not defined. Add it to <code>themes</code> in <code>~/.mulmoterminal/config.json</code>, or pick one
    below. Your choice is kept until then.
  </p>
  <p class="mb-2 mt-1.5 text-[12px] text-dim">
    Picks from the schemes that exist. Your own go in <code>themes</code> in <code>~/.mulmoterminal/config.json</code> and appear here next to the built-in four
    — the skill writes one from a palette, a photo or a brand's colours, and checks it for contrast.
  </p>
  <div ref="themesEl" class="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
    <button
      v-for="(t, i) in themes"
      :key="t.id"
      type="button"
      class="flex w-[84px] cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-elevated p-2 hover:bg-hover"
      :class="themeId === t.id ? 'border-accent text-fg' : 'border-border text-muted hover:text-fg'"
      role="radio"
      :aria-checked="themeId === t.id"
      :tabindex="isThemeTabStop(t.id, i) ? 0 : -1"
      :title="t.label"
      @click="setTheme(t.id)"
      @keydown="onThemeKey($event, i)"
    >
      <span class="relative h-[34px] w-full overflow-hidden rounded-md border border-border" :style="{ background: t.swatch.base }">
        <span class="absolute bottom-1.5 left-2 h-3 w-3 rounded-full" :style="{ background: t.swatch.panel }" />
        <span class="absolute bottom-1.5 left-6 h-3 w-3 rounded-full" :style="{ background: t.swatch.accent }" />
      </span>
      <span class="text-[12px]">{{ t.label }}</span>
    </button>
  </div>
  <div class="mt-3">
    <SkillLaunchButton skill="mulmoterminal-theme" icon="format_paint" label="Create a theme…" @launch="emit('launch-skill', $event)" />
  </div>
</template>
