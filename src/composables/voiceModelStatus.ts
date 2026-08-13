import { isVoiceInputStatus, type VoiceInputStatus } from "../../common/voiceInputStatus";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// One reader for `GET /api/transcribe/model`. Two callers want it for different reasons —
// the mic polls it for readiness, the settings modal asks once whether to show the voice
// section at all — and they had drifted into two fetches with two different notions of the
// response shape.
//
// Null for anything short of a parsed OK response, so both callers degrade to "no voice
// input" instead of having to tell a network blip from a machine without whisper.

// The route only reads memoized flags and a status object, so a response this slow means
// the server is wedged, not busy. Bounded because the mic polls this every 2s while a model
// downloads — an unanswered GET per tick would pile up.
const STATUS_TIMEOUT_MS = 5000;

export async function fetchVoiceInputStatus(): Promise<VoiceInputStatus | null> {
  try {
    const res = await fetchWithTimeout("/api/transcribe/model", undefined, STATUS_TIMEOUT_MS);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isVoiceInputStatus(body) ? body : null;
  } catch {
    return null;
  }
}
