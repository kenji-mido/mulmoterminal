<script setup lang="ts">
import { computed, ref } from "vue";
import { useSavedListMirror } from "../../composables/useSavedListMirror";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import { canAddRepo } from "../settingsValidators";
import SettingsListRow from "./SettingsListRow.vue";
import { SECTION_HEADING, SETTINGS_LIST } from "./sectionClasses";

const props = defineProps<{ prRepos?: string[] | undefined }>();
const emit = defineEmits<{ (e: "update-repos", repos: string[]): void }>();

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
  <h3 :class="SECTION_HEADING">Pull request repos</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Repos whose open PRs the cross-repo <strong>Pull requests</strong> view lists. Uses your <code>gh</code> login. Format: <code>owner/repo</code>.
  </p>
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
      aria-label="Add a repository (owner/repo)"
      spellcheck="false"
      @keydown.enter="addRepo"
    />
    <SettingsButton :disabled="!newRepoValid" @click="addRepo">Add</SettingsButton>
  </div>
</template>
