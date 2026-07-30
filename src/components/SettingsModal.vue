<script setup lang="ts">
// The Settings modal's shell: the dialog frame, its keyboard behavior, and the order the
// sections appear in.
//
// Each section owns its own state — its composable, or the one prop/emit pair it edits — so it
// is one file under ./settings, and what stays here is what belongs to the modal itself. The
// props/emits below are pure plumbing: they exist because the shells (and the specs) address
// this component, and each one is handed straight to the section that reads it.
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { MODAL_FOCUSABLE, trapTabKey } from "../utils/focusTrap";
import SettingsButton from "./SettingsButton.vue";
import ThemeSection from "./settings/ThemeSection.vue";
import TerminalFontSizeSection from "./settings/TerminalFontSizeSection.vue";
import TerminalScrollSection from "./settings/TerminalScrollSection.vue";
import WaitingRowsSection from "./settings/WaitingRowsSection.vue";
import DirAppearanceSection from "./settings/DirAppearanceSection.vue";
import DirSettingsSection from "./settings/DirSettingsSection.vue";
import NotificationSoundsSection from "./settings/NotificationSoundsSection.vue";
import VoiceInputSection from "./settings/VoiceInputSection.vue";
import WebPushSection from "./settings/WebPushSection.vue";
import GoogleAccountSection from "./settings/GoogleAccountSection.vue";
import PrReposSection from "./settings/PrReposSection.vue";
import LaunchersSection from "./settings/LaunchersSection.vue";
import QuickCommandsSection from "./settings/QuickCommandsSection.vue";
import McpServersSection from "./settings/McpServersSection.vue";
import CostSection from "./settings/CostSection.vue";
import ShortcutsSection from "./settings/ShortcutsSection.vue";
import HelpSection from "./settings/HelpSection.vue";
import type { Launcher } from "./launchers";
import type { UserMcpServer } from "./userMcp";
import type { QuickCommand } from "../../common/quickCommands";
import type { PushKind } from "../../common/pushKinds";
import type { NotifyKind } from "../../common/notifyKinds";
import type { SoundMap } from "../composables/soundSettings";
import type { BundledSkillName } from "../../common/bundledSkills";

defineProps<{
  soundFile?: string | null;
  soundKinds?: NotifyKind[];
  sounds?: SoundMap;
  pushEnabled?: boolean;
  pushKinds?: PushKind[];
  prRepos?: string[];
  launchers?: Launcher[];
  quickCommands?: QuickCommand[];
  userMcpServers?: UserMcpServer[];
  cwd?: string | null | undefined;
  sessionId?: string | null | undefined;
  // Directories to offer a config preview for: the recent-dir presets, plus the focused
  // session's own directory when it isn't one of them yet.
  dirPaths?: string[];
}>();

const emit = defineEmits<{
  (e: "update-sound", file: string | null): void;
  (e: "update-sound-kinds", kinds: NotifyKind[]): void;
  (e: "update-sounds", sounds: SoundMap): void;
  (e: "update-push-enabled", on: boolean): void;
  (e: "update-push-kinds", kinds: PushKind[]): void;
  (e: "update-repos", repos: string[]): void;
  (e: "update-launchers", launchers: Launcher[]): void;
  (e: "update-quick-commands", commands: QuickCommand[]): void;
  (e: "update-user-mcp", servers: UserMcpServer[]): void;
  // Hand a section over to the skill that owns it. Named by skill rather than by section
  // ("configure-appearance") so a new button costs nothing outside this file.
  (e: "launch-skill", skill: BundledSkillName): void;
  (e: "close"): void;
}>();

const modalEl = ref<HTMLElement>();

// Modal keyboard behavior: Escape closes; Tab is trapped within the dialog.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  if (e.key !== "Tab" || !modalEl.value) return;
  trapTabKey(e, modalEl.value, MODAL_FOCUSABLE);
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  nextTick(() => modalEl.value?.querySelector<HTMLElement>("input, button")?.focus());
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.55)]" @click.self="emit('close')">
    <div
      ref="modalEl"
      class="flex max-h-[85vh] w-[min(560px,92vw)] flex-col overflow-y-auto rounded-[10px] border border-border bg-base p-4 font-sans text-fg"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div class="flex items-center justify-between">
        <h2 class="m-0 text-[15px] font-semibold">Settings</h2>
        <button
          class="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] text-muted hover:bg-[var(--err-hover-bg)] hover:text-err-text"
          title="Close"
          aria-label="Close settings"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <ThemeSection @launch-skill="emit('launch-skill', $event)" />
      <TerminalFontSizeSection />
      <TerminalScrollSection />
      <WaitingRowsSection />
      <DirAppearanceSection @launch-skill="emit('launch-skill', $event)" />
      <DirSettingsSection :dir-paths="dirPaths" @launch-skill="emit('launch-skill', $event)" />
      <NotificationSoundsSection
        :sound-file="soundFile"
        :sound-kinds="soundKinds"
        :sounds="sounds"
        @update-sound="emit('update-sound', $event)"
        @update-sound-kinds="emit('update-sound-kinds', $event)"
        @update-sounds="emit('update-sounds', $event)"
        @launch-skill="emit('launch-skill', $event)"
      />
      <VoiceInputSection />
      <WebPushSection
        :push-enabled="pushEnabled"
        :push-kinds="pushKinds"
        @update-push-enabled="emit('update-push-enabled', $event)"
        @update-push-kinds="emit('update-push-kinds', $event)"
      />
      <GoogleAccountSection />
      <PrReposSection :pr-repos="prRepos" @update-repos="emit('update-repos', $event)" />
      <LaunchersSection :launchers="launchers" @update-launchers="emit('update-launchers', $event)" />
      <QuickCommandsSection :quick-commands="quickCommands" @update-quick-commands="emit('update-quick-commands', $event)" />
      <McpServersSection :user-mcp-servers="userMcpServers" @update-user-mcp="emit('update-user-mcp', $event)" />
      <CostSection :cwd="cwd" :session-id="sessionId" />
      <ShortcutsSection @launch-skill="emit('launch-skill', $event)" />
      <HelpSection />

      <div class="mt-4 flex items-center gap-2">
        <span class="flex-1" />
        <SettingsButton primary @click="emit('close')">Close</SettingsButton>
      </div>
    </div>
  </div>
</template>
