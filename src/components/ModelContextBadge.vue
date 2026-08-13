<script setup lang="ts">
import { computed } from "vue";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { modelBadge, type BadgeAgent } from "./modelBadge";
import { badgeTip } from "./tipContent";

// Which model is running + how full its context is, e.g. `Opus · ctx 35%`. Nothing renders until
// the transcript has told us the model; the text and the tip's wording are decided in ./modelBadge.
const props = defineProps<{
  agent: BadgeAgent;
  model: string | null;
  contextTokens: number;
}>();

const badge = computed(() => (props.model ? modelBadge(props.agent, props.model, props.contextTokens) : null));

// The badge shortens the model to `Opus`; the tip is where the full name and the token counts live.
const { described, show: showTip, hide: hideTip } = useHoverTipAnchor(() => badgeTip(badge.value?.title ?? ""));
</script>

<template>
  <span
    v-if="badge"
    data-testid="model-badge"
    class="flex-none whitespace-nowrap font-mono text-[10px] tracking-[0.02em] text-dim"
    :aria-describedby="described ? HOVER_TIP_ID : undefined"
    @pointerenter="showTip"
    @pointerleave="hideTip"
    @focusin="showTip"
    @focusout="hideTip"
    >{{ badge.text }}</span
  >
</template>
