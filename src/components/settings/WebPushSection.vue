<script setup lang="ts">
import { ref, watch } from "vue";
import { SECTION_HEADING } from "./sectionClasses";
import { PUSH_KINDS, type PushKind } from "../../../common/pushKinds";

const props = defineProps<{ pushEnabled?: boolean | undefined; pushKinds?: PushKind[] | undefined }>();
const emit = defineEmits<{
  (e: "update-push-enabled", on: boolean): void;
  (e: "update-push-kinds", kinds: PushKind[]): void;
}>();

// Stateless: reflects props.pushEnabled, emits the new value up (App persists it).
function onPushToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) emit("update-push-enabled", e.target.checked);
}

// Which kinds of push to send (#850). The master toggle above says whether to notify at all;
// this says which moments qualify, so a user who only wants finished turns can decline the ones
// a blocked agent raises. Editable mirror of the saved value, like the other lists here.
const PUSH_KIND_LABEL: Record<PushKind, string> = { finished: "Turn finished", waiting: "Waiting for you" };
const PUSH_KIND_HELP: Record<PushKind, string> = {
  finished: "the agent replied and the output is unread",
  waiting: "it stopped to ask — a permission prompt or a question. Fires once per prompt, so a task that asks a lot pushes a lot",
};
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
  <h3 :class="SECTION_HEADING">Web Push notifications</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Send a push to your registered devices when a background task finishes. Requires the <strong>RemoteHost</strong> connection — its sign-in provides the
    notification auth, so pushes only send while it's connected.
  </p>
  <label class="flex cursor-pointer items-center gap-2">
    <input type="checkbox" class="cursor-pointer" :checked="props.pushEnabled ?? false" aria-label="Send a Web Push to my devices" @change="onPushToggle" />
    <span>Notify my devices</span>
  </label>
  <div class="mt-2.5" :class="pushEnabled ? '' : 'pointer-events-none opacity-50'">
    <p class="mb-1.5 text-[12px] text-dim">Which moments are worth a push:</p>
    <label v-for="kind in PUSH_KINDS" :key="kind" class="flex cursor-pointer items-start gap-2 py-0.5">
      <input
        type="checkbox"
        class="mt-1 cursor-pointer"
        :checked="pushKindList.includes(kind)"
        :disabled="!pushEnabled"
        :aria-label="`Push when a session is ${kind}`"
        @change="togglePushKind(kind)"
      />
      <span class="text-[12px]">
        <strong>{{ PUSH_KIND_LABEL[kind] }}</strong> — {{ PUSH_KIND_HELP[kind] }}
      </span>
    </label>
  </div>
</template>
