// The backends this server can launch a session on, for the launch picker (#584).
//
// Fetched once and shared: a full grid mounts a dozen empty cells at the same moment, and
// each one wants the same list. The answer only changes when the user edits config.json or
// restarts the server with a different environment, so `reloadLaunchOptions` is there for
// the settings screen rather than a poll.
import { ref } from "vue";
import type { LaunchOptions, LaunchProviderOption } from "../../common/launchOptions";
import type { ModelPreset, ModelTrials } from "../../common/modelPresets";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// EVERY required field, not just the two the list renders. The guard asserts the whole
// LaunchProviderOption, and the picker goes on to read the rest of it — `sortedModels(provider.
// models)` iterates `models`, and `ready` / `tokenEnv` drive the disabled state and the setup
// hint. Checking only id/label would let a malformed row through under a type that promises them.
// `trials` is a discriminated union, and the picker's label branches on its `status` — an
// unrecognised one would render neither a measurement nor an honest "unmeasured".
const isModelTrials = (value: unknown): value is ModelTrials =>
  isRecord(value) &&
  ((value.status === "measured" &&
    typeof value.passed === "number" &&
    typeof value.of === "number" &&
    (value.medianSeconds === null || typeof value.medianSeconds === "number") &&
    typeof value.measuredAt === "string") ||
    (value.status === "unreachable" && typeof value.reason === "string" && typeof value.measuredAt === "string") ||
    value.status === "unmeasured");

// Every required field: the option label reads `contextLength` and `trials`, and the badge reads
// the price. A guard that stopped at id/label would assert a ModelPreset it had not seen.
const isModelPreset = (row: unknown): row is ModelPreset =>
  isRecord(row) &&
  typeof row.provider === "string" &&
  typeof row.id === "string" &&
  typeof row.label === "string" &&
  typeof row.contextLength === "number" &&
  isRecord(row.pricePerMTok) &&
  typeof row.pricePerMTok.input === "number" &&
  typeof row.pricePerMTok.output === "number" &&
  isModelTrials(row.trials);

const isLaunchProviderOption = (row: unknown): row is LaunchProviderOption =>
  isRecord(row) &&
  typeof row.id === "string" &&
  typeof row.label === "string" &&
  typeof row.ready === "boolean" &&
  typeof row.tokenEnv === "string" &&
  isUnknownArray(row.models) &&
  row.models.every(isModelPreset) &&
  (row.reason === undefined || typeof row.reason === "string");

const EMPTY: LaunchOptions = { providers: [], anyReady: false };
const FETCH_TIMEOUT_MS = 8000;

const options = ref<LaunchOptions>(EMPTY);
// The request currently in the air, so a grid mounting a dozen empty cells at once asks
// the server once. Cleared when it settles.
let inFlight: Promise<void> | null = null;
// Whether a fetch has actually SUCCEEDED. A failed one must not count: the first attempt
// can lose a race with a server that is still starting, and without this the picker would
// stay hidden for the rest of the page session even after the server came back.
let loaded = false;

async function fetchOptions(): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/launch-options", undefined, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`GET /api/launch-options → ${res.status}`);
    const body = await jsonBody(res);
    // THROWN, not defaulted to EMPTY: `jsonBody` answers `{}` for a body that is truncated or not
    // JSON at all, and treating that as a successful empty list would set `loaded` below and stop
    // every later mount from retrying — the exact failure the `loaded` flag exists to prevent.
    // A 200 we cannot read is a failed read, so it goes down the catch with the rest.
    if (!isUnknownArray(body.providers) || typeof body.anyReady !== "boolean") {
      throw new Error("GET /api/launch-options → body is not { providers, anyReady }");
    }
    options.value = { providers: body.providers.filter(isLaunchProviderOption), anyReady: body.anyReady };
    loaded = true;
  } catch (err) {
    // A picker that cannot load its list is not an error the user can act on — the launch
    // form still works and starts the session on the directory's own default. The next cell
    // to mount tries again.
    console.warn("[launch-options] falling back to the directory default:", err);
    options.value = EMPTY;
  } finally {
    // Cleared here rather than in a .finally() on the returned promise, so it is already
    // null by the time anything awaiting this call resumes.
    inFlight = null;
  }
}

const startFetch = (): Promise<void> => {
  inFlight = fetchOptions();
  return inFlight;
};

// Re-ask the server — for a settings screen that just changed what there is to offer.
export function reloadLaunchOptions(): Promise<void> {
  loaded = false;
  return startFetch();
}

export function useLaunchOptions() {
  if (!loaded && !inFlight) void startFetch();
  return { launchOptions: options };
}
