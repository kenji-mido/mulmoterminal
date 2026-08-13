<script setup lang="ts">
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { badgeStyleFor } from "./dirBadge";
import { WORKSPACE_LABEL } from "./presets";
import { textTip } from "./tipContent";

// The directory's `name` from .mulmoterminal.json, as the coloured chip in a GRID cell's header.
// Shared by all three grid cells (Claude/codex, launcher, command) so a project reads the same
// wherever it is running — before this they had 1, 0 and 0 copies of it respectively (#914).
//
// The single view's badge (Terminal.vue) is deliberately NOT this component: its header has more
// room and uses a wider cap and looser leading, and unifying them would change how it looks.
//
// `workspace` says this cell is running in THE workspace, and it wins over `name`: the badge then
// reads WORKSPACE with the same `workspaces` glyph the launcher chip uses, because the two are the
// same directory seen a second apart. Launching from the chip labelled WORKSPACE and landing in a
// cell badged `mulmoclaude` reads as two different places, and the folder's own name is the less
// useful of the two — its ROLE is why every GUI tool is reachable there (see WORKSPACE_LABEL).
//
// The colours are NOT overridden: `badgeColor` is still the directory's, so the workspace keeps the
// palette its `.mulmoterminal.json` gives it and only the wording is role-based. And the configured
// name is not lost — it is the hover tip, the same place a too-long name has always been readable.
const props = defineProps<{
  name: string | null | undefined;
  color: string | null | undefined;
  workspace?: boolean | undefined;
}>();

// The badge truncates at 14ch, so the tip is the only place a longer project name is readable —
// and, in workspace mode, the only place the directory's own name is shown at all.
const { described, show: showTip, hide: hideTip } = useHoverTipAnchor(() => textTip(props.name));
</script>

<template>
  <span
    v-if="workspace || name"
    :data-testid="workspace ? 'dir-badge-workspace' : undefined"
    class="flex-none truncate rounded-[10px] px-[7px] py-px font-sans text-[11px] font-semibold"
    :class="workspace ? 'max-w-none' : 'max-w-[14ch]'"
    :style="badgeStyleFor(color)"
    :aria-describedby="described ? HOVER_TIP_ID : undefined"
    @pointerenter="showTip"
    @pointerleave="hideTip"
    @focusin="showTip"
    @focusout="hideTip"
    ><template v-if="workspace"
      ><span class="material-symbols-outlined mr-[3px] align-middle text-[12px]" aria-hidden="true">workspaces</span>{{ WORKSPACE_LABEL }}</template
    ><template v-else>{{ name }}</template></span
  >
</template>
