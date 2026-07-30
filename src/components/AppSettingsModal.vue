<script setup lang="ts">
// The settings modal with its config wiring already attached.
//
// Both shells open the same modal — the chat view and the grid — and each wired the same five
// values and five save handlers to it by hand. Ten identical lines in two places is how one
// of them ends up missing a setting added later, and the symptom would be a control that
// silently does nothing in one view (#646 A5).
//
// useAppConfig's state is a singleton, so reading it here is the same state the shells read.
// What genuinely differs stays a prop or an event: the chat view knows a cwd and a session,
// and each shell opens the skill session its own way.
import { computed } from "vue";
import { useAppConfig } from "../composables/useAppConfig";
import SettingsModal from "./SettingsModal.vue";
import type { CwdPreset } from "./presets";
import type { BundledSkillName } from "../../common/bundledSkills";

// `presets` comes DOWN from the shell rather than out of useAppConfig() here: unlike the
// sound/push/launcher state, the preset list is a per-call ref, so the copy this component
// would get is a second, empty one — the shell that called loadConfig() has the real list.
const props = defineProps<{ cwd?: string | null; sessionId?: string | null; presets?: CwdPreset[] }>();
const emit = defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void; (e: "close"): void }>();

const {
  soundFile,
  saveSound,
  soundKinds,
  saveSoundKinds,
  sounds,
  saveSounds,
  pushEnabled,
  savePushEnabled,
  pushKinds,
  savePushKinds,
  prRepos,
  savePrRepos,
  launchers,
  saveLaunchers,
  quickCommands,
  saveQuickCommands,
  userMcpServers,
  saveUserMcpServers,
} = useAppConfig();

// Which directories the config preview lists: the recent dirs, plus the focused session's own
// directory when it isn't among them (the chat view knows a cwd; the grid doesn't).
const dirPaths = computed(() => {
  const paths = (props.presets ?? []).map((p) => p.path);
  return props.cwd && !paths.includes(props.cwd) ? [props.cwd, ...paths] : paths;
});
</script>

<template>
  <SettingsModal
    :sound-file="soundFile"
    :sound-kinds="soundKinds"
    :sounds="sounds"
    :push-enabled="pushEnabled"
    :push-kinds="pushKinds"
    :pr-repos="prRepos"
    :launchers="launchers"
    :quick-commands="quickCommands"
    :user-mcp-servers="userMcpServers"
    :cwd="cwd"
    :session-id="sessionId"
    :dir-paths="dirPaths"
    @update-sound="saveSound"
    @update-sound-kinds="saveSoundKinds"
    @update-sounds="saveSounds"
    @update-push-enabled="savePushEnabled"
    @update-push-kinds="savePushKinds"
    @update-repos="savePrRepos"
    @update-launchers="saveLaunchers"
    @update-quick-commands="saveQuickCommands"
    @update-user-mcp="saveUserMcpServers"
    @launch-skill="emit('launch-skill', $event)"
    @close="emit('close')"
  />
</template>
