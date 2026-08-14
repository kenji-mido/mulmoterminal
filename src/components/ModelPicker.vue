<script setup lang="ts">
// Which backend + model a session starts on, chosen at launch (#584). Sits in the empty
// cell's launch form, under the working directory.
//
// The choice lasts for this session only — the directory's .mulmoterminal.json still holds
// the default, and leaving this alone is what uses it. The picker only appears when there
// is something to choose between: with nothing offerable there is no decision to make,
// only setup to explain, so it collapses to a link into the help.
import { computed, ref } from "vue";
import { useLaunchOptions } from "../composables/useLaunchOptions";
import { isOfferable, notOfferedReason } from "./launchOffer";
import { modelOptionLabel, sortedModels } from "./modelOption";
import { SELECT_CONTROL } from "./selectClasses";
import ModelSetupHelp from "./ModelSetupHelp.vue";
import { LAUNCH_ROW } from "./launchFormClasses";
import type { LaunchChoice } from "./wsUrl";

const props = defineProps<{ modelValue: LaunchChoice | null }>();
const emit = defineEmits<{ (e: "update:modelValue", choice: LaunchChoice | null): void }>();

const { launchOptions } = useLaunchOptions();
const helpOpen = ref(false);

// Only what can actually be picked: reachable, and with models to choose from. A provider
// missing either is left to the help, which names the single thing that is missing — offering
// one with no models renders a group header with nothing under it, which a browser draws as a
// row that cannot be clicked or arrowed to (#1432).
const offerable = computed(() => launchOptions.value.providers.filter(isOfferable));

// Whether some configured backend is not offered. Said on the help link rather than left to the
// user to discover, because the picker looks complete when another provider works.
const anyNeedsAttention = computed(() => launchOptions.value.providers.some((provider) => notOfferedReason(provider) !== null));

const helpLabel = computed(() => {
  if (anyNeedsAttention.value) return "Needs attention";
  return launchOptions.value.anyReady ? "How this works" : "Use another model…";
});

// One flat <select>: "<provider>|<model>", empty string for the directory's own default.
const SEPARATOR = "|";
const selected = computed({
  get: () => (props.modelValue?.model ? `${props.modelValue.provider ?? ""}${SEPARATOR}${props.modelValue.model}` : ""),
  set: (value: string) => {
    if (!value) return emit("update:modelValue", null);
    const [provider, model] = value.split(SEPARATOR);
    emit("update:modelValue", { provider: provider || null, ...(model === undefined ? {} : { model }) });
  },
});
</script>

<template>
  <div class="flex flex-col items-center gap-1.5" :class="LAUNCH_ROW">
    <span class="flex w-full items-center justify-between">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">Model</span>
      <button
        type="button"
        data-testid="cell-model-help"
        class="cursor-pointer border-none bg-transparent p-0 font-sans text-[11px] text-dim underline hover:text-fg"
        @click="helpOpen = true"
      >
        {{ helpLabel }}
      </button>
    </span>

    <select
      v-if="offerable.length"
      v-model="selected"
      data-testid="cell-model-select"
      aria-label="Model for this session"
      :class="[SELECT_CONTROL, 'font-mono']"
    >
      <option value="">This directory's default</option>
      <optgroup v-for="provider in offerable" :key="provider.id" :label="provider.label">
        <option v-for="model in sortedModels(provider.models)" :key="model.id" :value="`${provider.id}${SEPARATOR}${model.id}`">
          {{ modelOptionLabel(model) }}
        </option>
      </optgroup>
    </select>

    <ModelSetupHelp v-if="helpOpen" :providers="launchOptions.providers" @close="helpOpen = false" />
  </div>
</template>
