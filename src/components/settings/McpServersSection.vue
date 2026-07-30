<script setup lang="ts">
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddMcpServer } from "../settingsValidators";
import type { UserMcpServer } from "../userMcp";
import SettingsListRow from "./SettingsListRow.vue";
import { SECTION_HEADING, SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ userMcpServers?: UserMcpServer[] | undefined }>();
const emit = defineEmits<{ (e: "update-user-mcp", servers: UserMcpServer[]): void }>();

// User HTTP MCP servers (id + url) merged into the single-view Claude session.
const { items: mcpServers, replace } = useSavedListMirror<UserMcpServer>(
  () => props.userMcpServers,
  (next) => emit("update-user-mcp", next),
);

const newMcpId = ref("");
const newMcpUrl = ref("");
const newMcpValid = computed(() => canAddMcpServer(newMcpId.value, newMcpUrl.value, mcpServers.value));
function addMcpServer() {
  if (!newMcpValid.value) return;
  replace([...mcpServers.value, { id: newMcpId.value.trim(), url: newMcpUrl.value.trim() }]);
  newMcpId.value = "";
  newMcpUrl.value = "";
}
function removeMcpServer(id: string) {
  replace(mcpServers.value.filter((s) => s.id !== id));
}
</script>

<template>
  <h3 :class="SECTION_HEADING">MCP servers</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    HTTP MCP servers the <strong>single-view</strong> Claude session loads (in addition to the built-in GUI tools). <code>id</code> is the server name;
    <code>url</code> is its streamable-HTTP endpoint. In the Docker sandbox, a <code>localhost</code> URL is reached over <code>host.docker.internal</code>
    automatically. Takes effect on the next Claude session.
  </p>
  <ul v-if="mcpServers.length" :class="SETTINGS_LIST">
    <SettingsListRow v-for="s in mcpServers" :key="s.id" :name="s.id" @remove="removeMcpServer(s.id)">
      <span class="flex-auto font-mono text-[12px] text-secondary">{{ s.id }}</span>
      <code class="min-w-0 flex-auto truncate font-mono text-[11px] text-dim">{{ s.url }}</code>
    </SettingsListRow>
  </ul>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="newMcpId"
      class="min-w-0 shrink grow basis-[30%]"
      placeholder="id (e.g. weather)"
      aria-label="MCP server id"
      spellcheck="false"
      @keydown.enter="addMcpServer"
    />
    <SettingsField
      v-model="newMcpUrl"
      class="min-w-0 flex-auto font-mono"
      placeholder="https://… or http://localhost:PORT/mcp"
      aria-label="MCP server URL"
      spellcheck="false"
      @keydown.enter="addMcpServer"
    />
    <SettingsButton :disabled="!newMcpValid" @click="addMcpServer">Add</SettingsButton>
  </div>
</template>
