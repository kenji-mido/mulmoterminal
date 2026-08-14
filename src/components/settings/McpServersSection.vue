<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddMcpServer } from "../settingsValidators";
import type { UserMcpServer } from "../userMcp";
import SettingsListRow from "./SettingsListRow.vue";
import { SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ userMcpServers?: UserMcpServer[] | undefined }>();
const emit = defineEmits<{ (e: "update-user-mcp", servers: UserMcpServer[]): void }>();

const { t } = useI18n();

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
  <i18n-t keypath="settings.mcp.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #singleView>
      <strong>{{ t("settings.mcp.singleView") }}</strong>
    </template>
    <template #idKey><code>id</code></template>
    <template #urlKey><code>url</code></template>
    <template #localhost><code>localhost</code></template>
    <template #dockerHost><code>host.docker.internal</code></template>
  </i18n-t>
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
      :placeholder="t('settings.mcp.idPlaceholder')"
      :aria-label="t('settings.mcp.idField')"
      spellcheck="false"
      @keydown.enter="addMcpServer"
    />
    <SettingsField
      v-model="newMcpUrl"
      class="min-w-0 flex-auto font-mono"
      :placeholder="t('settings.mcp.urlPlaceholder')"
      :aria-label="t('settings.mcp.urlField')"
      spellcheck="false"
      @keydown.enter="addMcpServer"
    />
    <SettingsButton :disabled="!newMcpValid" @click="addMcpServer">{{ t("settings.common.add") }}</SettingsButton>
  </div>
</template>
