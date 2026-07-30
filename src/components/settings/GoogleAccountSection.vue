<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useGoogleLink } from "../../composables/useGoogleLink";
import SettingsButton from "../SettingsButton.vue";
import { SECTION_HEADING } from "./sectionClasses";

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
  if (!googleStatus.value) return "Checking…";
  if (googleStatus.value.pending) return "Waiting for consent in your browser…";
  return googleStatus.value.linked ? "Linked" : "Not linked";
});

// Broker (GCP settings-free link) removes the client secret requirement. When a broker is available,
// consent can flow through it; otherwise, a Desktop client's secret on disk is needed.
const googleSecretHint = computed(() => {
  if (googleStatus.value?.brokerAvailable) return "";
  const presence = googleStatus.value?.clientSecret;
  if (presence === "missing")
    return "No OAuth client secret found in ~/.secrets. Add a Desktop client's client_secret_*.json there to enable sign-in, or use the GCP-settings-free broker link if available.";
  if (presence === "ambiguous") return "Multiple client_secret_*.json files in ~/.secrets — keep exactly one.";
  return "";
});

async function onUnlinkGoogle() {
  if (!window.confirm("Unlink this Google account? MulmoTerminal will lose Calendar access until you sign in again.")) return;
  await unlinkGoogle();
}

onMounted(() => void refreshGoogle());
onUnmounted(disposeGoogle);
</script>

<template>
  <h3 :class="SECTION_HEADING">Google account</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Link a Google account so the <code>google</code> tool and your phone can read and create <strong>Calendar</strong> events. Sign-in opens in a new tab and
    finishes on <strong>this machine</strong>, so use a browser here — over a remote connection, run <code>npx mulmoterminal@latest google login</code> instead.
    The link is shared with MulmoClaude.
  </p>
  <p v-if="googleSecretHint" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text">{{ googleSecretHint }}</p>
  <div class="mb-3 flex items-center gap-2.5">
    <span class="text-[12px]" :class="googleStatus?.linked ? 'text-ok' : 'text-muted'">{{ googleStatusText }}</span>
    <SettingsButton
      v-if="!googleStatus?.linked"
      :disabled="googleBusy || googleStatus?.pending || (googleStatus?.clientSecret !== 'found' && !googleStatus?.brokerAvailable)"
      @click="connectGoogle"
    >
      Sign in with Google
    </SettingsButton>
    <SettingsButton v-else :disabled="googleBusy" @click="onUnlinkGoogle">Unlink</SettingsButton>
  </div>
  <p v-if="googleError" data-testid="google-warn" class="mb-3 mt-1.5 text-[12px] text-err-text" role="alert">{{ googleError }}</p>
</template>
