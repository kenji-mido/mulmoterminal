<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddQuickCommand } from "../settingsValidators";
import SettingsListRow from "./SettingsListRow.vue";
import { SETTINGS_LIST } from "./sectionClasses";
import type { QuickCommand } from "../../../common/quickCommands";
import { SESSION_AGENTS, type SessionAgent } from "../../../common/sessionAgent";

const props = defineProps<{ quickCommands?: QuickCommand[] | undefined }>();
const emit = defineEmits<{ (e: "update-quick-commands", commands: QuickCommand[]): void }>();

const { t } = useI18n();

// Phrases the phone offers as chips on a session (#830). `agents` scopes an entry to session
// kinds, and selecting none means every kind.
const { items: quickCommandList, replace } = useSavedListMirror<QuickCommand>(
  () => props.quickCommands,
  (next) => emit("update-quick-commands", next),
);

const newQuickLabel = ref("");
const newQuickText = ref("");
const newQuickAgents = ref<SessionAgent[]>([]);
const newQuickValid = computed(() => canAddQuickCommand(newQuickLabel.value, newQuickText.value, quickCommandList.value));

function toggleNewQuickAgent(agent: SessionAgent) {
  newQuickAgents.value = newQuickAgents.value.includes(agent) ? newQuickAgents.value.filter((a) => a !== agent) : [...newQuickAgents.value, agent];
}

function addQuickCommand() {
  if (!newQuickValid.value) return;
  const label = newQuickLabel.value.trim();
  const text = newQuickText.value.trim();
  // Omit `agents` rather than send [] — the server reads an empty list as "every kind" too,
  // but leaving the key out is what the config format documents for "unscoped".
  const agents = newQuickAgents.value.length ? [...newQuickAgents.value] : undefined;
  replace([...quickCommandList.value, agents ? { label, text, agents } : { label, text }]);
  newQuickLabel.value = "";
  newQuickText.value = "";
  newQuickAgents.value = [];
}

function removeQuickCommand(label: string) {
  replace(quickCommandList.value.filter((c) => c.label !== label));
}

const agentScopeLabel = (command: QuickCommand): string => (command.agents?.length ? command.agents.join(" / ") : "all");
</script>

<template>
  <i18n-t keypath="settings.quickCommands.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #labelExample><code>PR</code></template>
    <template #textExample><code>PR作って</code></template>
    <template #gitStatus><code>git status</code></template>
  </i18n-t>
  <ul v-if="quickCommandList.length" :class="SETTINGS_LIST">
    <SettingsListRow v-for="c in quickCommandList" :key="c.label" :name="c.label" @remove="removeQuickCommand(c.label)">
      <span class="flex-none font-mono text-[12px] text-secondary">{{ c.label }}</span>
      <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ c.text }}</code>
      <span class="flex-none rounded-sm bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-muted">{{ agentScopeLabel(c) }}</span>
    </SettingsListRow>
  </ul>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="newQuickLabel"
      class="min-w-0 shrink grow basis-[25%]"
      :placeholder="t('settings.quickCommands.labelPlaceholder')"
      :aria-label="t('settings.quickCommands.labelField')"
      spellcheck="false"
      @keydown.enter="addQuickCommand"
    />
    <SettingsField
      v-model="newQuickText"
      class="min-w-0 flex-auto"
      :placeholder="t('settings.quickCommands.textPlaceholder')"
      :aria-label="t('settings.quickCommands.textField')"
      spellcheck="false"
      @keydown.enter="addQuickCommand"
    />
    <SettingsButton :disabled="!newQuickValid" @click="addQuickCommand">{{ t("settings.common.add") }}</SettingsButton>
  </div>
  <div class="mt-1.5 flex items-center gap-3">
    <span class="text-[11px] text-muted">{{ t("settings.quickCommands.offerTo") }}</span>
    <label v-for="agent in SESSION_AGENTS" :key="agent" class="flex cursor-pointer items-center gap-1 text-[11px] text-dim">
      <input
        type="checkbox"
        class="cursor-pointer"
        :checked="newQuickAgents.includes(agent)"
        :aria-label="t('settings.quickCommands.offerToAgent', { agent })"
        @change="toggleNewQuickAgent(agent)"
      />
      <span class="font-mono">{{ agent }}</span>
    </label>
    <span class="text-[11px] text-muted">{{ t("settings.quickCommands.offerToNone") }}</span>
  </div>
</template>
