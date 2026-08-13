<script setup lang="ts">
// What this cell is working on: `#977 → #966` — the branch's PR, and the issue that PR closes.
// With many cells in the grid it is the only place that answers "which of these is on the thing
// I asked about", which is how a PR gets left half-finished when a cell is reused (#979).
//
// Disappears the moment the PR is merged (or closed): the work is over, and a stale badge is
// worse than none. Before a PR exists the issue shows on its own, since that is most of the time
// a cell spends on an issue.
import { computed } from "vue";
import type { WorkItem } from "../../common/prPhase";
import { hasWorkToShow } from "../composables/useWorkItem";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { phaseDisplay } from "./rosterPhase";
import { workTip } from "./tipContent";

const props = defineProps<{ item: WorkItem }>();

const show = computed(() => hasWorkToShow(props.item));
const phase = computed(() => phaseDisplay(props.item.phase));

// The hover tip carries what the chip has no room for: what the PR and the issue actually ARE.
// Those titles have been arriving since #1014 and were shown nowhere on the desktop, which is why
// the chip could say `#2689 → #2688` and still leave you opening GitHub to find out which is which.
const { described, show: showTip, hide: hideTip } = useHoverTipAnchor(() => workTip(props.item));
</script>

<template>
  <span
    v-if="show"
    data-testid="work-chip"
    class="inline-flex h-[1.5em] max-w-[18ch] flex-none items-center gap-[0.25em] overflow-hidden whitespace-nowrap rounded-[0.75em] bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-[0.4em] font-sans text-[0.72rem] leading-[1.5em] opacity-85"
    :aria-describedby="described ? HOVER_TIP_ID : undefined"
    @pointerenter="showTip"
    @pointerleave="hideTip"
    @focusin="showTip"
    @focusout="hideTip"
  >
    <a
      v-if="item.pr !== null"
      data-testid="work-pr"
      :href="item.prUrl ?? undefined"
      target="_blank"
      rel="noopener"
      class="text-inherit no-underline hover:underline"
      >#{{ item.pr }}</a
    >
    <span v-if="item.pr !== null && item.issue !== null" data-testid="work-arrow" class="opacity-60">→</span>
    <a
      v-if="item.issue !== null"
      data-testid="work-issue"
      :href="item.issueUrl ?? undefined"
      target="_blank"
      rel="noopener"
      class="text-inherit no-underline hover:underline"
      >#{{ item.issue }}</a
    >
    <span v-if="phase" data-testid="work-phase" class="opacity-70">{{ phase.label }}</span>
  </span>
</template>
