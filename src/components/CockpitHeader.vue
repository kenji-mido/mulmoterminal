<script setup lang="ts">
// The status/dir header bar shared by the cockpit roster rows and the strip thumbnails, so both
// read as the same directory: the bar is always tinted with the dir's configured header colour
// (status is carried by the dot + badge, not the bar background), with the roster's status
// wording. Trailing controls — the roster's ⋮ reorder menu, or a thumbnail's expand/close —
// go in the default slot.
import { computed } from "vue";
import { formatCwd } from "./cwdDisplay";
import { CELL_DIR_PATH, DIR_TRUNCATE_FRONT } from "./cellChromeClasses";
import { headerStyleFor } from "./cellHeaderStyle";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { phaseDisplay, WORK_WORD, type PrPhase, type WorkPhase } from "./rosterPhase";
import { textTip } from "./tipContent";
import type { AttentionStatus } from "./attentionStatus";
import { agentBadge } from "../../common/sessionAgent";

const props = withDefaults(
  defineProps<{
    status: AttentionStatus;
    agent: string;
    cwd: string | null;
    home: string | null;
    headerColor: string | null;
    headerTextColor: string | null;
    workPhase?: WorkPhase | null;
    phase?: PrPhase;
    dirLength?: number;
  }>(),
  { workPhase: null, phase: "none", dirLength: 44 },
);

const STATUS_WORD: Record<AttentionStatus, string> = { working: "running", blocked: "waiting", done: "done", idle: "idle" };
// Hardcoded, token-less roster hues — come through as arbitrary utilities; fill + text paired.
// `done` is the exception: it names --done, the one green every view paints a finished turn with
// (#1307), so it cannot drift from the cell's ring or the row's edge.
const DOT_CLASS: Record<AttentionStatus, string> = { working: "bg-[#4a9eff]", done: "bg-done", blocked: "bg-[#f59e0b]", idle: "bg-[#666]" };
const BADGE_CLASS: Record<AttentionStatus, string> = {
  working: "bg-[#4a9eff] text-[#04121f]",
  done: "bg-done text-[#04120a]",
  blocked: "bg-[#f59e0b] text-[#1f1300]",
  idle: "bg-[#333] text-[#ddd]",
};
// Outlined pill, coloured by PR lifecycle; anything unlisted keeps the neutral grey.
const PHASE_CLASS: Record<string, string> = {
  "ci-running": "text-[#4a9eff]",
  "ci-failing": "text-[#f87171]",
  "changes-requested": "text-[#f59e0b]",
  ready: "text-[#22c55e]",
  merged: "text-[#a78bfa]",
};

// A working cell shows what it's doing (planning / editing) when known, else the plain word.
const badgeWord = computed(() => (props.status === "working" && props.workPhase ? WORK_WORD[props.workPhase] : STATUS_WORD[props.status]));
const phaseInfo = computed(() => phaseDisplay(props.phase ?? "none"));

// The roster row is its own template, not a TerminalCell (docs/grid-view-modes.md), so it binds the
// shared tip itself. Its two chips are the ones that hide something: a phase pill abbreviated to a
// word, and a path truncated from the front.
const { described: phaseDescribed, show: showPhaseTip, hide: hidePhaseTip } = useHoverTipAnchor(() => textTip(phaseInfo.value?.title));
const { described: dirDescribed, show: showDirTip, hide: hideDirTip } = useHoverTipAnchor(() => textTip(props.cwd));
// Null for claude (the default, so nearly every row) and for a shell, which is not an agent.
const badge = computed(() => agentBadge(props.agent));
const phaseColor = computed(() => PHASE_CLASS[props.phase ?? "none"] ?? "text-[#9aa4b2]");
const dirText = computed(() => formatCwd(props.cwd, props.home, props.dirLength ?? 44) || "—");
const barStyle = computed(() => headerStyleFor(props.headerColor, props.headerTextColor));
</script>

<template>
  <div
    data-testid="cockpit-header"
    class="flex min-w-0 items-center gap-1.5 bg-[var(--cell-header-bg,transparent)] px-2.5 py-1.5 text-[var(--cell-header-fg,inherit)]"
    :style="barStyle"
  >
    <span data-testid="cockpit-dot" class="h-2 w-2 flex-none rounded-full" :class="DOT_CLASS[status]" aria-hidden="true" />
    <span data-testid="cockpit-badge" class="flex-none rounded-full px-1.5 py-px text-[10px] font-bold" :class="BADGE_CLASS[status]">{{ badgeWord }}</span>
    <span
      v-if="phaseInfo"
      data-testid="cockpit-phase"
      class="flex-none whitespace-nowrap rounded-full border border-current px-1.5 text-[10px] font-bold"
      :class="[`ph-${phase}`, phaseColor]"
      :aria-describedby="phaseDescribed ? HOVER_TIP_ID : undefined"
      @pointerenter="showPhaseTip"
      @pointerleave="hidePhaseTip"
      @focusin="showPhaseTip"
      @focusout="hidePhaseTip"
      >{{ phaseInfo.label }}</span
    >
    <span v-if="badge" class="flex-none rounded-[4px] border border-border px-1 text-[10px] text-[#9ab]">{{ badge.full }}</span>
    <span
      data-testid="cockpit-dir"
      class="min-w-0 flex-auto text-[11px] text-[var(--cell-header-fg,var(--text-dim))]"
      :class="DIR_TRUNCATE_FRONT"
      :aria-describedby="dirDescribed ? HOVER_TIP_ID : undefined"
      @pointerenter="showDirTip"
      @pointerleave="hideDirTip"
      @focusin="showDirTip"
      @focusout="hideDirTip"
      ><span :class="CELL_DIR_PATH">{{ dirText }}</span></span
    >
    <slot />
  </div>
</template>
