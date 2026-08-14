<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppConfig } from "../../composables/useAppConfig";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import { issueWorkComments, saveIssueWorkComments } from "../../composables/issueWorkComments";
import { prWorkdirFooter, savePrWorkdirFooter } from "../../composables/prWorkdirFooter";
import { normalizeGitlabHost } from "../../../common/gitlabHosts";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddGitlabHost } from "../settingsValidators";
import SettingsListRow from "./SettingsListRow.vue";
import { SETTINGS_LIST } from "./sectionClasses";

// What this app writes to a forge on the user's behalf. Grouped because that is the question a
// reader has — "what does it post as me?" — not because the three keys are related in the config.
//
// Read straight from the composables rather than through the modal's props: useAppConfig's state
// is a singleton, so a section that owns one setting can own its whole loop (ThemeSection and
// WaitingRowsSection already do).
const { t } = useI18n();
const { gitlabHosts, saveGitlabHosts } = useAppConfig();

function onWorkCommentsToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveIssueWorkComments(e.target.checked);
}
function onFooterToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void savePrWorkdirFooter(e.target.checked);
}

const { items: hosts, replace } = useSavedListMirror<string>(
  () => gitlabHosts.value,
  (next) => void saveGitlabHosts(next),
);

const newHost = ref("");
const newHostValid = computed(() => canAddGitlabHost(newHost.value, hosts.value));
function addHost() {
  const host = normalizeGitlabHost(newHost.value);
  // Normalized before it is stored, not just before it is judged: the server would normalize it
  // anyway, and the list must show what was actually saved.
  if (!host || hosts.value.includes(host)) return;
  replace([...hosts.value, host]);
  newHost.value = "";
}
function removeHost(host: string) {
  replace(hosts.value.filter((h) => h !== host));
}
</script>

<template>
  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="issueWorkComments"
      :aria-label="t('settings.github.issueComments')"
      @change="onWorkCommentsToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.github.issueCommentsTitle") }}</strong> —
      <i18n-t keypath="settings.github.issueCommentsHint" tag="span">
        <template #gh><code>gh</code></template>
        <template #glab><code>glab</code></template>
      </i18n-t>
    </span>
  </label>

  <label class="mt-2 flex cursor-pointer items-start gap-2">
    <input type="checkbox" class="mt-1 cursor-pointer" :checked="prWorkdirFooter" :aria-label="t('settings.github.prFooter')" @change="onFooterToggle" />
    <span class="text-[12px]">
      <strong>{{ t("settings.github.prFooter") }}</strong> —
      <i18n-t keypath="settings.github.prFooterHint" tag="span">
        <template #line><code>work in &lt;clone&gt;</code></template>
      </i18n-t>
    </span>
  </label>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settings.github.gitlabTitle") }}</strong> —
    <i18n-t keypath="settings.github.gitlabHint" tag="span">
      <template #glab><code>glab</code></template>
      <template #authCommand><code>glab auth login --hostname &lt;host&gt;</code></template>
    </i18n-t>
  </p>
  <ul v-if="hosts.length" :class="SETTINGS_LIST">
    <SettingsListRow v-for="h in hosts" :key="h" :name="h" @remove="removeHost(h)">
      <span class="flex-auto font-mono text-[12px] text-secondary">{{ h }}</span>
    </SettingsListRow>
  </ul>
  <div class="mb-3 flex items-center gap-2">
    <SettingsField
      v-model="newHost"
      class="flex-auto font-mono"
      placeholder="gitlab.example.com"
      :aria-label="t('settings.github.gitlabField')"
      spellcheck="false"
      @keydown.enter="addHost"
    />
    <SettingsButton :disabled="!newHostValid" @click="addHost">{{ t("settings.common.add") }}</SettingsButton>
  </div>
</template>
