<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { previewNotify } from "../../composables/useAttentionSound";
import { customSoundLabel, isCustomSound, toggledKinds, withKindSound, type SoundMap } from "../../composables/soundSettings";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SELECT_CONTROL } from "../selectClasses";
import { NOTIFY_KINDS, type NotifyKind } from "../../../common/notifyKinds";
import { presetRef, SOUND_PRESETS } from "../../../common/notifySounds";
import type { BundledSkillName } from "../../../common/bundledSkills";
import type { SoundEmits } from "./soundEmits";
import { filePickerOpen, pickPaths } from "../../composables/pickPaths";

const props = defineProps<{ soundFile?: string | null | undefined; soundKinds?: NotifyKind[] | undefined; sounds?: SoundMap | undefined }>();
const emit = defineEmits<SoundEmits & { (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();

// Which moments beep, and what each one plays (#873). The toolbar's speaker icon says whether to
// beep at all, this says which moments qualify.
const kindLabel = (kind: NotifyKind): string => t(`settings.sounds.kinds.${kind}`);

const soundKindList = ref<NotifyKind[]>([...(props.soundKinds ?? [])]);
watch(
  () => props.soundKinds,
  (k) => (soundKindList.value = [...(k ?? [])]),
);
function toggleSoundKind(kind: NotifyKind) {
  soundKindList.value = toggledKinds(soundKindList.value, kind);
  emit("update-sound-kinds", soundKindList.value);
}

// Editable mirror of the saved map. It has to be a LOCAL ref and not `props.sounds`: the whole
// map is persisted on every change, so two picks made before the first POST answers would both
// compute from the same pre-save snapshot and the second would drop the first. This is the hazard
// createPresetMutations serializes writes for.
const soundMap = ref<SoundMap>({ ...(props.sounds ?? {}) });
watch(
  () => props.sounds,
  (m) => (soundMap.value = { ...(m ?? {}) }),
);

// "" is the fallback (the file below, else the chime). A kind whose saved value is a PATH —
// only settable by hand in config.json — gets an extra option so picking a preset for another
// kind can't silently drop it. The editing itself is pure, in composables/soundSettings.
const soundValue = (kind: NotifyKind): string => soundMap.value[kind] ?? "";
function setKindSound(kind: NotifyKind, value: string) {
  soundMap.value = withKindSound(soundMap.value, kind, value);
  emit("update-sounds", soundMap.value);
}
function onKindSoundChange(kind: NotifyKind, e: Event) {
  if (e.target instanceof HTMLSelectElement) setKindSound(kind, e.target.value);
}
// Preview what this kind would play, resolved the same way a real beep resolves it (the kind's
// own sound, else the fallback file, else the chime). Reads the LOCAL map so a preset picked a
// moment ago is what you hear — a preset is fetched by id and needs no saved config. Falling
// back to `soundFile` still shows the saved path, which is the only value the server can stream.
function testKindSound(kind: NotifyKind) {
  void previewNotify(kind, { kinds: soundKindList.value, sounds: soundMap.value, soundFile: props.soundFile ?? null });
}

// Custom attention sound, applied immediately (like the theme) — empty => the
// built-in chime. The text box mirrors the saved value; Browse / typing apply it.
const soundPath = ref(props.soundFile ?? "");
// A host with no file dialog installed: the field still takes a typed path, which nobody discovers
// from a Browse button that does nothing (#1447).
const pickError = ref<string | null>(null);
watch(
  () => props.soundFile,
  (f) => (soundPath.value = f ?? ""),
);

function applySound() {
  emit("update-sound", soundPath.value.trim() || null);
}
function clearSound() {
  soundPath.value = "";
  emit("update-sound", null);
}
async function browseSound() {
  const { paths, error } = await pickPaths();
  pickError.value = error;
  const picked = paths[0];
  if (picked) {
    soundPath.value = picked;
    applySound();
  }
}
</script>

<template>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">{{ t("settings.sounds.intro") }}</p>
  <div v-for="kind in NOTIFY_KINDS" :key="kind" class="py-0.5">
    <div class="flex items-center gap-2">
      <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="shrink-0 cursor-pointer"
          :checked="soundKindList.includes(kind)"
          :aria-label="t('settings.sounds.beepAria', { kind })"
          @change="toggleSoundKind(kind)"
        />
        <span class="truncate text-[12px]"
          ><strong>{{ kindLabel(kind) }}</strong></span
        >
      </label>
      <!-- The width lives on this wrapper, not the select: SELECT_CONTROL is `w-full`, and a
           `w-44` beside it is the same specificity — which of the two wins is decided by the
           order Tailwind emits them, not by the order written here. -->
      <div class="w-36 shrink-0">
        <select
          :value="soundValue(kind)"
          :disabled="!soundKindList.includes(kind)"
          :aria-label="t('settings.sounds.soundFor', { label: kindLabel(kind) })"
          :class="SELECT_CONTROL"
          class="truncate"
          @change="onKindSoundChange(kind, $event)"
        >
          <option value="">{{ t("settings.sounds.default") }}</option>
          <option v-for="preset in SOUND_PRESETS" :key="preset.id" :value="presetRef(preset.id)">{{ preset.label }}</option>
          <option v-if="isCustomSound(soundValue(kind))" :value="soundValue(kind)">{{ customSoundLabel(soundValue(kind)) }}</option>
        </select>
      </div>
      <SettingsButton class="shrink-0" :title="t('settings.sounds.playFor', { label: kindLabel(kind) })" @click="testKindSound(kind)"
        ><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span></SettingsButton
      >
    </div>
    <p class="ml-6 text-[11px] text-dim">{{ t(`settings.sounds.help.${kind}`) }}</p>
  </div>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong>{{ t("settings.sounds.defaultTitle") }}</strong> {{ t("settings.sounds.defaultHint") }}
  </p>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="soundPath"
      class="flex-auto font-mono"
      placeholder="/absolute/path/to/sound.wav"
      :aria-label="t('settings.sounds.fileField')"
      spellcheck="false"
      @change="applySound"
    />
    <SettingsButton :disabled="filePickerOpen" @click="browseSound">{{ t("settings.sounds.browse") }}</SettingsButton>
    <SettingsButton :disabled="!soundPath" :title="t('settings.sounds.useChimeTitle')" @click="clearSound">{{ t("settings.sounds.useChime") }}</SettingsButton>
  </div>
  <p v-if="pickError" data-testid="sound-pick-error" class="mt-1.5 text-[12px] text-err-text" role="alert">{{ pickError }}</p>
  <p class="mb-3 mt-3 text-[12px] text-dim">{{ t("settings.sounds.outro") }}</p>
  <SkillLaunchButton skill="mulmoterminal-notify" icon="notifications_active" :label="t('settings.sounds.configure')" @launch="emit('launch-skill', $event)" />
</template>
