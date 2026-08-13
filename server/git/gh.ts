// Shared `gh` CLI runner for the cross-repo PR / issue views. The GitHub CLI's own
// login is the auth; args are passed as argv only (no shell). Callers get a per-repo
// result and decide how to surface errors, so one failing repo never sinks the view.
import { spawnCollect } from "./spawn-collect.js";

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// What `spawnCollect` reports when `gh` could not be started at all. Named rather than inlined
// because it is the ONLY way to tell "no CLI here" from "the CLI ran and the forge said no" —
// a spawn failure produces no exit status and no HTTP status (see forge-failure.ts).
export const GH_MISSING_STDERR = "gh not found (install the GitHub CLI and run `gh auth login`)";

export function runGh(args: string[]): Promise<GhResult> {
  return spawnCollect("gh", args, { errorStderr: GH_MISSING_STDERR });
}
