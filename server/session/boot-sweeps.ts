// The one-shot cleanups the server runs on the way up, lifted out of index.ts when the 4.8.2
// merge pushed it past the 600-line limit. They belong together: each one deletes something an
// EARLIER version of this server left behind, none of them can fail the boot, and all of them are
// addressed by name or by directory rather than by guessing at content.
import { sweepLegacyProbeTranscriptsOnce } from "../agents/probe-transcript.js";
import { removeLegacySandboxCredentials, removeLegacySandboxContainers } from "../infra/fs-cleanup.js";
import { sweepOrphanHeadlessTranscripts } from "./headless-session.js";

/** Fire-and-forget: called for its side effects, and a failure in any of them must never abort
 *  startup — which is why every promise here is caught and dropped. */
export function runBootSweeps(claudeCwd: string, mulmoterminalHome: string): void {
  // Probes that ran before their ids identified them left transcripts nothing can address by name —
  // 41 of one reporter's 50 listed sessions (#1010). Swept ONCE on this machine, never again: the
  // content test cannot tell those files from a person who typed the probe's exact words, so the
  // window in which that matters is closed rather than reopened on every boot (Codex review on
  // #1030). It also means a 500MB transcript directory is read once, not once per `yarn dev` save.
  void sweepLegacyProbeTranscriptsOnce(claudeCwd, mulmoterminalHome).catch(() => {});

  // The removed Docker sandbox left two things behind when a server was killed or upgraded
  // mid-session: a per-session export of the Keychain credential on disk, and a container still
  // running with the workspace and ~/.claude mounted. Both deleters went with the feature.
  //
  // The directory is the EVIDENCE that this machine ever ran the sandbox, so the container sweep is
  // gated on it: nearly every install never turned it on (opt-in, macOS-only) and never invokes
  // docker here at all (Codex, PR #1195).
  if (removeLegacySandboxCredentials(mulmoterminalHome)) void removeLegacySandboxContainers(mulmoterminalHome).catch(() => {});

  // A headless run deletes its own transcript when it ends, so whatever is left belongs to one that
  // never got to: the server was killed mid-title, or the delete failed. Every boot, not once ever —
  // the files are addressed by a NAME only this server can mint, so there is no content guess to
  // regret and no user conversation it could reach. It reads the directory listing and nothing else.
  void sweepOrphanHeadlessTranscripts(claudeCwd).catch(() => {});
}
