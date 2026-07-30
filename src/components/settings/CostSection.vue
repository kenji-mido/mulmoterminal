<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useCost } from "../../composables/useCost";
import { formatUsd } from "../formatUsd";
import { SECTION_HEADING } from "./sectionClasses";

const props = defineProps<{ cwd?: string | null | undefined; sessionId?: string | null | undefined }>();

// Read-only estimated cost (Session / Today / Month), loaded when the modal opens.
const { cost, error: costError, load: loadCost } = useCost();

// Load unconditionally — the server falls back to the workspace when no cwd is passed, so
// Today/Month still populate in the grid view (no active single-view session ⇒ no cwd/sessionId).
// Re-fetch if cwd/sessionId arrive or change while open.
const refreshCost = () => void loadCost(props.cwd ?? null, props.sessionId ?? null);
onMounted(refreshCost);
watch([() => props.cwd, () => props.sessionId], refreshCost);
</script>

<template>
  <h3 :class="SECTION_HEADING">Cost (estimated)</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Estimated spend for this project from <strong>public per-model pricing</strong> (input, output, and cache tokens) — actual billing may differ, and flat-plan
    (Max) usage isn't reflected. Today / Month roll up this project's sessions.
  </p>
  <div class="flex gap-2" role="group" aria-label="Estimated cost" title="Estimated from public per-model pricing; actual billing may differ.">
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Session</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.session) }}</span>
    </div>
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Today</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.today) }}</span>
    </div>
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">Month</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.month) }}</span>
    </div>
  </div>
  <p v-if="costError" class="mt-2 text-[12px] text-dim">Couldn't load cost estimate.</p>
  <p v-else-if="cost && (cost.unpricedTurns > 0 || cost.sessionUnpricedTurns > 0)" class="mt-2 text-[12px] text-dim">
    Some turns used a model with no known price and are excluded from these estimates.
  </p>
</template>
