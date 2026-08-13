<script setup lang="ts">
import { computed } from "vue";
import type { GitStatus } from "../../common/gitStatus";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { gitTip } from "./tipContent";

// `hideDirty` suppresses the dirty count for worktree cells, which already show
// ahead/dirty vs their base branch in the diff badge next to this chip.
const props = defineProps<{ status: GitStatus | null; hideDirty?: boolean }>();

const label = computed(() => (props.status?.detached ? "detached" : (props.status?.branch ?? "")));

// The tip keeps the full branch name, which the chip truncates at 16ch — the part a long
// `fix/1235-…` name loses is exactly the part that says what the branch is for.
const { described, show: showTip, hide: hideTip } = useHoverTipAnchor(() => gitTip(props.status));
</script>

<template>
  <span
    v-if="status?.repo && (status.branch || status.detached)"
    data-testid="git-chip"
    class="inline-flex h-[1.5em] max-w-[16ch] flex-none items-center gap-[0.25em] overflow-hidden whitespace-nowrap rounded-[0.75em] bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-[0.4em] font-sans text-[0.72rem] leading-[1.5em] opacity-85"
    :class="status.detached ? 'text-[#d19a66]' : 'text-inherit'"
    :aria-describedby="described ? HOVER_TIP_ID : undefined"
    @pointerenter="showTip"
    @pointerleave="hideTip"
    @focusin="showTip"
    @focusout="hideTip"
  >
    <span data-testid="git-branch" class="overflow-hidden text-ellipsis">⎇ {{ label }}</span>
    <span v-if="!hideDirty && status.dirty > 0" data-testid="git-dirty" class="text-[#e5c07b]">●{{ status.dirty }}</span>
    <span v-if="status.upstream && status.ahead > 0" data-testid="git-ab" class="opacity-80">↑{{ status.ahead }}</span>
    <span v-if="status.upstream && status.behind > 0" data-testid="git-ab" class="opacity-80">↓{{ status.behind }}</span>
  </span>
</template>
