<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useAppConfig } from "../../composables/useAppConfig";
import { useLaunchOptions } from "../../composables/useLaunchOptions";
import { isOfferable, notOfferedReason } from "../launchOffer";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SETTINGS_LIST } from "./sectionClasses";

const { t } = useI18n();
import type { BundledSkillName } from "../../../common/bundledSkills";

// Read-only, like the shortcuts list: a provider is a name, a base URL and the env var its key is
// read from, and an editor for that is a form with a "your key is in the wrong variable" failure
// mode. What this section owes the user is the answer to "what can a session run on right now",
// which is two lists.
//
// Providers come from /api/launch-options rather than the config, because that route RESOLVES
// them — it reports `ready`, which the raw config cannot. Custom agents come from the config,
// because there is nothing to resolve: the command is the user's own and is run as written.
const { launchOptions } = useLaunchOptions();
const { customAgents } = useAppConfig();

defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();
</script>

<template>
  <i18n-t keypath="settings.models.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #providersKey><code>providers</code></template>
    <template #configFile><code>~/.mulmoterminal/config.json</code></template>
    <template #providerKey><code>provider</code></template>
    <template #modelKey><code>model</code></template>
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
  <ul v-if="launchOptions.providers.length" :class="SETTINGS_LIST">
    <li v-for="p in launchOptions.providers" :key="p.id" class="flex items-baseline gap-2 rounded-md bg-elevated px-2 py-1.5">
      <span class="font-mono text-[12px] text-secondary">{{ p.label }}</span>
      <span class="text-[11px] text-dim">
        {{ t("settings.models.modelCount", { count: p.models.length }, p.models.length) }} · {{ t("settings.models.keyIn", { env: p.tokenEnv }) }}
      </span>
      <span class="flex-auto" />
      <span v-if="!p.ready" class="text-[11px] text-err-text" :title="p.reason">{{ t("settings.models.notReady") }}</span>
      <!-- Reachable, and still not a choice: a session cannot be started on a provider without a
           model, so the launch picker leaves it out. Said here because "ready · 0 models" reads
           like it works (#1432). -->
      <span v-else-if="!isOfferable(p)" class="text-[11px] text-err-text" :title="notOfferedReason(p) ?? ''">
        {{ t("settings.models.notInPicker") }}
      </span>
      <span v-else class="text-[11px] text-dim">{{ t("settings.models.ready") }}</span>
    </li>
  </ul>
  <p v-else class="mb-2 text-[12px] text-dim">{{ t("settings.models.noProviders") }}</p>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settings.models.customTitle") }}</strong> (<code>customAgents</code>) {{ t("settings.models.customIntro") }}
  </p>
  <ul v-if="customAgents.length" :class="SETTINGS_LIST">
    <li v-for="agent in customAgents" :key="agent.id" class="flex flex-col gap-0.5 rounded-md bg-elevated px-2 py-1.5">
      <span class="font-mono text-[12px] text-secondary">{{ agent.label }}</span>
      <span class="truncate font-mono text-[11px] text-dim" :title="agent.command">{{ agent.command }}</span>
    </li>
  </ul>
  <p v-else class="mb-2 text-[12px] text-dim">{{ t("settings.models.noCustomAgents") }}</p>

  <div class="mb-3 mt-2">
    <SkillLaunchButton skill="mulmoterminal-model" icon="network_node" :label="t('settings.models.addBackend')" @launch="$emit('launch-skill', $event)" />
  </div>
</template>
