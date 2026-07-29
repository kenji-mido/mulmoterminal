// Which build of the CLIENT this server is handing out.
//
// A browser tab keeps running the JavaScript it loaded. Restart the server with a new bundle and
// every tab that stays open carries on with the old one — silently, indefinitely. That is not a
// theoretical worry: a tab left open through a rebuild spent an afternoon reproducing behaviour
// that had already been fixed, and the code was searched three times before the tab was
// suspected. Nothing anywhere said the two were out of step.
//
// So the server names its build and the client compares. Derived from the built index.html
// rather than from a boot id: index.html carries the hashed asset filenames, so it changes when
// and only when the client bundle changes. A boot id would change on every restart and cry
// "reload" at a user whose code is already current — which is how a prompt gets ignored.
//
// Null when there is no build to name (a `yarn dev` run, where Vite serves the client and reloads
// it itself). The client treats null as "nothing to compare" and stays quiet.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** A short, stable name for the bundle `indexHtml` loads. Same content, same id. */
export function buildIdOf(indexHtml: string): string {
  return createHash("sha256").update(indexHtml).digest("hex").slice(0, 16);
}

/** The id for the client this server serves, or null when it serves none (dev). Read once: the
 *  files cannot change under a running server without a restart, which mints a new id anyway. */
export function readBuildId(clientDir: string): string | null {
  try {
    return buildIdOf(readFileSync(path.join(clientDir, "index.html"), "utf8"));
  } catch {
    return null; // no built client here — Vite is serving it
  }
}
