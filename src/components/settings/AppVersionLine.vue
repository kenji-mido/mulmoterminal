<script setup lang="ts">
// Which build is running, under the Settings title. It sits in the modal's header rather than in
// a section at the bottom because the question is asked while filing a bug report — scrolling
// past two dozen sections to find the answer is how #1520 got filed in the first place.
//
// Labelled and chipped rather than a bare `v4.7.0 · a1b2c3d`: an unlabelled string of numbers
// under a title reads as decoration, and a reader should not have to guess that the hex is a
// commit. The update notice repeats what the header badge says, in the one place the badge is
// covered up — the modal is open over it. No copy button here; the badge's popover owns that.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useUpdateStatus } from "../../composables/useUpdateStatus";
import { versionDisplay } from "../../composables/updateNotice";

const { t } = useI18n();
const { status, badge } = useUpdateStatus();
const display = computed(() => versionDisplay(status.value));

const CHIP = "rounded-[0.4em] bg-selected px-1.5 py-[0.15em] font-mono text-[11px] leading-[1.5]";
</script>

<template>
  <div v-if="display" class="mt-1 flex flex-col gap-1">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="material-symbols-outlined text-[14px] leading-none text-muted" aria-hidden="true">deployed_code</span>
      <span class="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{{ t("settings.version.label") }}</span>
      <span :class="CHIP" class="text-fg" data-testid="settings-app-version">{{ display.version }}</span>
      <span v-if="display.commit" :class="CHIP" class="text-muted" data-testid="settings-app-commit">
        {{ t("settings.version.commit", { sha: display.commit }) }}
      </span>
    </div>
    <p v-if="badge" class="m-0 inline-flex items-center gap-1 text-[11px] leading-tight text-accent">
      <span class="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">upgrade</span>
      {{ badge.text }}
    </p>
  </div>
</template>
