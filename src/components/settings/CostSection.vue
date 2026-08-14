<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useCost } from "../../composables/useCost";
import { formatUsd } from "../formatUsd";

const props = defineProps<{ cwd?: string | null | undefined; sessionId?: string | null | undefined }>();

// Read-only estimated cost (Session / Today / Month), loaded when the modal opens.
const { t } = useI18n();
const { cost, error: costError, load: loadCost } = useCost();

// Load unconditionally — the server falls back to the workspace when no cwd is passed, so
// Today/Month still populate in the grid view (no active single-view session ⇒ no cwd/sessionId).
// Re-fetch if cwd/sessionId arrive or change while open.
const refreshCost = () => void loadCost(props.cwd ?? null, props.sessionId ?? null);
onMounted(refreshCost);
watch([() => props.cwd, () => props.sessionId], refreshCost);
</script>

<template>
  <i18n-t keypath="settings.cost.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #pricing>
      <strong>{{ t("settings.cost.pricing") }}</strong>
    </template>
  </i18n-t>
  <div class="flex gap-2" role="group" :aria-label="t('settings.cost.group')" :title="t('settings.cost.groupTitle')">
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">{{ t("settings.cost.session") }}</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.session) }}</span>
    </div>
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">{{ t("settings.cost.today") }}</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.today) }}</span>
    </div>
    <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-elevated p-2.5">
      <span class="text-[11px] uppercase tracking-[0.04em] text-muted">{{ t("settings.cost.month") }}</span>
      <span class="font-mono text-[16px] font-semibold text-fg">{{ formatUsd(cost?.month) }}</span>
    </div>
  </div>
  <p v-if="costError" class="mt-2 text-[12px] text-dim">{{ t("settings.cost.failed") }}</p>
  <p v-else-if="cost && (cost.unpricedTurns > 0 || cost.sessionUnpricedTurns > 0)" class="mt-2 text-[12px] text-dim">
    {{ t("settings.cost.unpriced") }}
  </p>
</template>
