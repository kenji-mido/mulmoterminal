<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useGoogleLink } from "../../composables/useGoogleLink";
import SettingsButton from "../SettingsButton.vue";

const { t } = useI18n();

// The modal is v-if'd, so a fresh load on mount also picks up out-of-band changes
// (`mulmoterminal google login`, a deleted token file).
const {
  status: googleStatus,
  busy: googleBusy,
  error: googleError,
  refresh: refreshGoogle,
  connect: connectGoogle,
  unlink: unlinkGoogle,
  dispose: disposeGoogle,
} = useGoogleLink();

const googleStatusText = computed(() => {
  if (!googleStatus.value) return t("settings.google.checking");
  if (googleStatus.value.pending) return t("settings.google.pending");
  return t(googleStatus.value.linked ? "settings.google.linked" : "settings.google.notLinked");
});

// Broker (GCP settings-free link) removes the client secret requirement. When a broker is available,
// consent can flow through it; otherwise, a Desktop client's secret on disk is needed.
const googleSecretHint = computed(() => {
  if (googleStatus.value?.brokerAvailable) return "";
  const presence = googleStatus.value?.clientSecret;
  if (presence === "missing") return t("settings.google.secretMissing");
  if (presence === "ambiguous") return t("settings.google.secretAmbiguous");
  return "";
});

async function onUnlinkGoogle() {
  if (!window.confirm(t("settings.google.confirmUnlink"))) return;
  await unlinkGoogle();
}

onMounted(() => void refreshGoogle());
onUnmounted(disposeGoogle);
</script>

<template>
  <i18n-t keypath="settings.google.intro" tag="p" class="mb-3 mt-1.5 text-[12px] text-dim">
    <template #tool><code>google</code></template>
    <template #calendar>
      <strong>{{ t("settings.google.calendar") }}</strong>
    </template>
    <template #thisMachine>
      <strong>{{ t("settings.google.thisMachine") }}</strong>
    </template>
    <template #cli><code>npx mulmoterminal@latest google login</code></template>
  </i18n-t>
  <p v-if="googleSecretHint" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text">{{ googleSecretHint }}</p>
  <div class="mb-3 flex items-center gap-2.5">
    <span class="text-[12px]" :class="googleStatus?.linked ? 'text-ok' : 'text-muted'">{{ googleStatusText }}</span>
    <SettingsButton
      v-if="!googleStatus?.linked"
      :disabled="googleBusy || googleStatus?.pending || (googleStatus?.clientSecret !== 'found' && !googleStatus?.brokerAvailable)"
      @click="connectGoogle"
    >
      {{ t("settings.google.signIn") }}
    </SettingsButton>
    <SettingsButton v-else :disabled="googleBusy" @click="onUnlinkGoogle">{{ t("settings.google.unlink") }}</SettingsButton>
  </div>
  <p v-if="googleError" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text" role="alert">{{ googleError }}</p>
</template>
