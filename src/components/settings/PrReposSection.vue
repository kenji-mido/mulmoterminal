<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddRepo } from "../settingsValidators";
import SettingsListRow from "./SettingsListRow.vue";
import { SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ prRepos?: string[] | undefined }>();
const emit = defineEmits<{ (e: "update-repos", repos: string[]): void }>();

const { t } = useI18n();

// Cross-repo PR view's repos ("owner/repo").
const { items: repos, replace } = useSavedListMirror<string>(
  () => props.prRepos,
  (next) => emit("update-repos", next),
);

const newRepo = ref("");
const newRepoValid = computed(() => canAddRepo(newRepo.value, repos.value));
function addRepo() {
  if (!newRepoValid.value) return;
  replace([...repos.value, newRepo.value.trim()]);
  newRepo.value = "";
}
function removeRepo(repo: string) {
  replace(repos.value.filter((r) => r !== repo));
}
</script>

<template>
  <i18n-t keypath="settings.prRepos.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #view>
      <strong>{{ t("settings.prRepos.view") }}</strong>
    </template>
    <template #gh><code>gh</code></template>
    <template #format><code>owner/repo</code></template>
  </i18n-t>
  <ul v-if="repos.length" :class="SETTINGS_LIST">
    <SettingsListRow v-for="r in repos" :key="r" :name="r" @remove="removeRepo(r)">
      <span class="flex-auto font-mono text-[12px] text-secondary">{{ r }}</span>
    </SettingsListRow>
  </ul>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="newRepo"
      class="flex-auto font-mono"
      placeholder="owner/repo"
      :aria-label="t('settings.prRepos.field')"
      spellcheck="false"
      @keydown.enter="addRepo"
    />
    <SettingsButton :disabled="!newRepoValid" @click="addRepo">{{ t("settings.common.add") }}</SettingsButton>
  </div>
</template>
