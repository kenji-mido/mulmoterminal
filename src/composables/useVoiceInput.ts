// Thin Vue wrapper over the framework-neutral capture controller in
// `@mulmoclaude/core/whisper/client` (shared with MulmoClaude). This file supplies
// MulmoTerminal's transport (plain fetch — there is no shared api client) and
// locale mapping, and mirrors the controller's pushed state into Vue refs. The
// capture logic (MediaRecorder + VAD + segment queue) lives in the package.
//
// Capability vs availability:
//   capable   — macOS + whisper-server/ffmpeg present (controls button visibility)
//   available — capable AND the model is downloaded (controls recording)
// Clicking the mic while capable-but-not-available downloads the model on demand.

import { onScopeDispose, ref, type Ref } from "vue";
import { createVoiceCapture, type VoiceCaptureTransport } from "@mulmoclaude/core/whisper/client";
import { browserLocale } from "../utils/browserLocale";
import { modelReadiness, voiceAction } from "./voiceAction";
import { browserVoiceLanguage, resolveVoiceLanguage, voiceLanguage } from "./voiceLanguage";
import { fetchVoiceInputStatus } from "./voiceModelStatus";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

export interface UseVoiceInput {
  /** Platform + binaries present — gate the mic button's visibility on this. */
  capable: Ref<boolean>;
  /** Capable AND model ready — recording can start. */
  available: Ref<boolean>;
  /** The model is being fetched (after the first mic click). */
  downloading: Ref<boolean>;
  listening: Ref<boolean>;
  transcribing: Ref<boolean>;
  error: Ref<string | null>;
  refreshAvailability: () => Promise<void>;
  /** One-button UX: download → start → stop depending on current state. */
  toggle: () => Promise<void>;
  stop: () => void;
}

export interface UseVoiceInputOptions {
  /** Called with each segment's transcript once recognized (never empty). */
  onTranscript: (text: string) => void;
}

// The controller's transport: plain fetch for transcription + a status poll that doubles
// as our capability/downloading refresh (keeps `capable`/`downloading` in sync).
function createVoiceTransport(capable: Ref<boolean>, downloading: Ref<boolean>): VoiceCaptureTransport {
  return {
    async transcribe(dataUrl, language) {
      const res = await fetchWithTimeout(
        "/api/transcribe",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataUrl, language }),
        },
        SLOW_COMMAND_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`transcription failed (HTTP ${res.status})`);
      const body: unknown = await res.json();
      // The one field the caller inserts into the terminal — checked, so a malformed reply is a
      // thrown error here rather than `undefined` typed into someone's prompt.
      if (!isRecord(body) || typeof body.text !== "string") throw new Error("transcription returned no text");
      return { text: body.text };
    },
    // `status` is null on a transient fetch/non-OK; `model` may be absent on a partial
    // response. Optional-chain throughout so a status blip degrades to "not ready" instead
    // of throwing and wedging the controller's poll loop.
    async getStatus() {
      const status = await fetchVoiceInputStatus();
      capable.value = status?.capable ?? false;
      const readiness = modelReadiness(status);
      downloading.value = readiness.downloading;
      return readiness;
    },
  };
}

export function useVoiceInput(opts: UseVoiceInputOptions): UseVoiceInput {
  const capable = ref(false);
  const available = ref(false);
  const downloading = ref(false);
  const listening = ref(false);
  const transcribing = ref(false);
  const error = ref<string | null>(null);

  const transport = createVoiceTransport(capable, downloading);
  // Read per segment (the controller calls this getter per clip), so flipping the setting
  // takes effect on the next thing you say rather than on the next reload.
  const language = () => resolveVoiceLanguage(voiceLanguage.value, browserVoiceLanguage(browserLocale()));
  const capture = createVoiceCapture(transport, language, {
    onTranscript: (text) => {
      error.value = null;
      opts.onTranscript(text);
    },
    onError: (message) => {
      error.value = message;
    },
    onState: (state) => {
      available.value = state.available;
      listening.value = state.listening;
      transcribing.value = state.transcribing;
    },
  });

  // Start the (one-time) model download, then let the controller's poll flip
  // `available` to true once it lands.
  async function requestDownload(): Promise<void> {
    downloading.value = true;
    try {
      const res = await fetchWithTimeout("/api/transcribe/model/download", { method: "POST" });
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    } catch (err) {
      downloading.value = false;
      error.value = err instanceof Error ? err.message : String(err);
      return;
    }
    await capture.refreshAvailability();
  }

  async function toggle(): Promise<void> {
    const action = voiceAction({ listening: listening.value, available: available.value, downloading: downloading.value });
    if (action === "stop") return capture.stop();
    if (action === "start") {
      error.value = null;
      await capture.start();
      return;
    }
    if (action === "download") await requestDownload();
  }

  onScopeDispose(() => capture.dispose());

  return {
    capable,
    available,
    downloading,
    listening,
    transcribing,
    error,
    refreshAvailability: capture.refreshAvailability,
    toggle,
    stop: capture.stop,
  };
}
