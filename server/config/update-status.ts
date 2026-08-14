// What is running and whether anything newer exists: the header badge's "update available" and
// the Settings version line read the same answer. The server runs the check itself (shared
// computeUpdateInfo) rather than reading a launcher-written file, because under `yarn dev` the
// launcher isn't in the loop — only the server is. Recomputed on each start so it reflects the
// current checkout (a `git pull` clears the notice on the next restart); the probe is background
// and best-effort.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { computeUpdateInfo, readInstallInfo, isUpdateCheckDisabled } from "../../bin/update-check.js";
import { isRecord } from "../../common/isRecord.js";
import type { UpdateStatus } from "../../common/updateStatus.js";

// This file is server/config/update-status.ts, so two dirs up is the install root — the git
// checkout (dev / a clone) or the package dir under node_modules (npm) the check runs against.
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Our OWN package.json, read through require so the version is available without a JSON import
// assertion. Validated rather than asserted: a build that ships a package.json without a version
// should say so here, not hand `undefined` to the update check as though it were a version.
const pkg: unknown = createRequire(import.meta.url)("../../package.json");
const VERSION = isRecord(pkg) && typeof pkg.version === "string" ? pkg.version : "0.0.0";

// The version is known synchronously, so it is served from the first request on. Every other
// field is a placeholder until the probe lands — including `install`, which needs a git call to
// decide — and `ready` is how the client knows not to read them yet.
let cached: UpdateStatus = { ready: false, install: "npm", version: VERSION, commit: null, latest: null, notice: null };
export function getUpdateStatus(): UpdateStatus {
  return cached;
}

// Populate the in-memory status the route serves. Call fire-and-forget at startup. Best-effort —
// a failure leaves the last good value rather than disrupting the server.
//
// The opt-out silences the update NOTICE, not the version display: a user who turned off the
// nagging still needs to be able to read which build they are on, and the local probe that
// answers that reaches no network.
export async function refreshUpdateStatus(): Promise<void> {
  try {
    cached = isUpdateCheckDisabled(process.env)
      ? { ready: true, ...(await readInstallInfo(PKG_DIR, VERSION)), latest: null, notice: null }
      : { ready: true, ...(await computeUpdateInfo(PKG_DIR, VERSION)) };
  } catch {
    // best-effort — keep the last good value
  }
}
