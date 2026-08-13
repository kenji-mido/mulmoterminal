// The `GET /api/transcribe/model` response. The server builds it; the UI decides the mic
// button's visibility and the settings section's from it — both sides read it, so it lives
// here rather than as one interface per side.
//
// Deliberately independent of whisper's own types: this is the API contract, and which
// package implements transcription behind it is not the UI's business. The server's
// `getVoiceInputStatus(): VoiceInputStatus` annotation is what keeps the two in step.

import { isRecord } from "./isRecord.js";

export type VoiceModelState = "idle" | "downloading" | "ready" | "error";

export interface VoiceInputStatus {
  /** The platform and binaries are present — the mic can appear. */
  capable: boolean;
  model: {
    name: string;
    state: VoiceModelState;
    /** 0..1, only while downloading and only when the size is known. */
    progress?: number;
    error?: string;
  };
}

export const VOICE_MODEL_STATES: readonly VoiceModelState[] = ["idle", "downloading", "ready", "error"];

/** The wire response as it arrives from `GET /api/transcribe/model`. Lives beside the type so the
 *  guard and the shape it checks cannot drift; the UI treats anything else as "no status". */
export function isVoiceInputStatus(value: unknown): value is VoiceInputStatus {
  if (!isRecord(value) || typeof value.capable !== "boolean" || !isRecord(value.model)) return false;
  const { name, state, progress, error } = value.model;
  if (typeof name !== "string" || !VOICE_MODEL_STATES.some((known) => known === state)) return false;
  if (progress !== undefined && typeof progress !== "number") return false;
  return error === undefined || typeof error === "string";
}
