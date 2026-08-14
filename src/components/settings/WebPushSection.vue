<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PUSH_KINDS, type PushKind } from "../../../common/pushKinds";

const props = defineProps<{ pushEnabled?: boolean | undefined; pushKinds?: PushKind[] | undefined }>();
const emit = defineEmits<{
  (e: "update-push-enabled", on: boolean): void;
  (e: "update-push-kinds", kinds: PushKind[]): void;
}>();

const { t } = useI18n();

// Stateless: reflects props.pushEnabled, emits the new value up (App persists it).
function onPushToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) emit("update-push-enabled", e.target.checked);
}

// Which kinds of push to send (#850). The master toggle above says whether to notify at all;
// this says which moments qualify, so a user who only wants finished turns can decline the ones
// a blocked agent raises. Editable mirror of the saved value, like the other lists here.
const pushKindList = ref<PushKind[]>([...(props.pushKinds ?? [])]);
watch(
  () => props.pushKinds,
  (k) => (pushKindList.value = [...(k ?? [])]),
);
function togglePushKind(kind: PushKind) {
  // Emitted in PUSH_KINDS order so the saved list reads the same however it was clicked.
  const next = pushKindList.value.includes(kind) ? pushKindList.value.filter((k) => k !== kind) : [...pushKindList.value, kind];
  pushKindList.value = PUSH_KINDS.filter((k) => next.includes(k));
  emit("update-push-kinds", pushKindList.value);
}
</script>

<template>
  <i18n-t keypath="settings.push.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #remoteHost>
      <strong>{{ t("settings.push.remoteHost") }}</strong>
    </template>
  </i18n-t>
  <label class="flex cursor-pointer items-center gap-2">
    <input type="checkbox" class="cursor-pointer" :checked="props.pushEnabled ?? false" :aria-label="t('settings.push.master')" @change="onPushToggle" />
    <span>{{ t("settings.push.masterLabel") }}</span>
  </label>
  <div class="mt-2.5" :class="pushEnabled ? '' : 'pointer-events-none opacity-50'">
    <p class="mb-1.5 text-[12px] text-dim">{{ t("settings.push.whichMoments") }}</p>
    <label v-for="kind in PUSH_KINDS" :key="kind" class="flex cursor-pointer items-start gap-2 py-0.5">
      <input
        type="checkbox"
        class="mt-1 cursor-pointer"
        :checked="pushKindList.includes(kind)"
        :disabled="!pushEnabled"
        :aria-label="t('settings.push.kindAria', { kind })"
        @change="togglePushKind(kind)"
      />
      <span class="text-[12px]">
        <strong>{{ t(`settings.push.kinds.${kind}`) }}</strong> — {{ t(`settings.push.help.${kind}`) }}
      </span>
    </label>
  </div>
</template>
