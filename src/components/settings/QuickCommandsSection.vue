<script setup lang="ts">
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddQuickCommand } from "../settingsValidators";
import SettingsListRow from "./SettingsListRow.vue";
import { SECTION_HEADING, SETTINGS_LIST } from "./sectionClasses";
import type { QuickCommand } from "../../../common/quickCommands";
import { SESSION_AGENTS, type SessionAgent } from "../../../common/sessionAgent";

const props = defineProps<{ quickCommands?: QuickCommand[] | undefined }>();
const emit = defineEmits<{ (e: "update-quick-commands", commands: QuickCommand[]): void }>();

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
  <h3 :class="SECTION_HEADING">Phone quick commands</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Phrases you send often, offered as chips on the phone's terminal view. Tapping one puts the text in the input box — it isn't sent until you press send. The
    label is the chip's face, so keep it short. Example: <code>PR</code> → <code>PR作って</code>. Leave every kind unchecked to offer a command everywhere, or
    tick the ones it suits — <code>git status</code> belongs to a shell, not to Claude.
  </p>
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
      placeholder="Label"
      aria-label="Quick command label"
      spellcheck="false"
      @keydown.enter="addQuickCommand"
    />
    <SettingsField
      v-model="newQuickText"
      class="min-w-0 flex-auto"
      placeholder="text to insert (e.g. PR作って)"
      aria-label="Quick command text"
      spellcheck="false"
      @keydown.enter="addQuickCommand"
    />
    <SettingsButton :disabled="!newQuickValid" @click="addQuickCommand">Add</SettingsButton>
  </div>
  <div class="mt-1.5 flex items-center gap-3">
    <span class="text-[11px] text-muted">Offer to:</span>
    <label v-for="agent in SESSION_AGENTS" :key="agent" class="flex cursor-pointer items-center gap-1 text-[11px] text-dim">
      <input
        type="checkbox"
        class="cursor-pointer"
        :checked="newQuickAgents.includes(agent)"
        :aria-label="`Offer to ${agent} sessions`"
        @change="toggleNewQuickAgent(agent)"
      />
      <span class="font-mono">{{ agent }}</span>
    </label>
    <span class="text-[11px] text-muted">(none ticked = every kind)</span>
  </div>
</template>
