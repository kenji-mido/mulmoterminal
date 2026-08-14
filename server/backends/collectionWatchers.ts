// Collection completion bells, shared with MulmoClaude via @mulmoclaude/core. The
// watcher fs.watches each collection's data dir; when a record the schema marks as
// "pending completion" lands (or its file/done-state changes), the reconciler drives
// the notifier: publish an "action" bell while pending, clear it when done.
//
// CROSS-APP PARITY: MulmoTerminal and MulmoClaude share ONE notifier file
// (<ws>/data/notifier/active.json) and never run simultaneously. For a record to
// carry exactly ONE bell regardless of which app published it, this adapter MUST be
// byte-identical to MulmoClaude's (server/workspace/collections/notifications.ts):
// the same pluginPkg and the same wrap/unwrap helpers (in ./collectionNotifierAdapter),
// whose `readEntry` recognises ANY legacy entry by its marker. Then MulmoTerminal's
// reconciler recognises a bell MulmoClaude already published (same legacyId) and won't
// add a duplicate — and vice-versa. Diverging here is what produced double bells.
import path from "node:path";
import { configureCollectionWatchers, startCollectionWatchers, stopCollectionWatchers } from "@mulmoclaude/core/collection-watchers";
import type { CollectionNotificationAdapter } from "@mulmoclaude/core/collection-watchers";
import { buildNavigateTarget, buildPluginData, priorityToSeverity, readEntry } from "./collectionNotifierAdapter.js";
import { listProjectRoots, projectIdForRoot } from "../infra/project-root.js";
import { isRecord } from "../../common/isRecord.js";

const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[collection-watchers] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[collection-watchers] ${message}`, data ?? ""),
};

/** The record's ROOT as the opaque project id the client can ask for, or undefined for the
 *  workspace and for a root this server does not serve as a project — the two cases whose link
 *  is the plain, pre-project one. Resolved HERE rather than inside the adapter helpers so those
 *  stay free of server infra: a `test/src` spec imports them, and reaching `node:crypto` through
 *  them puts Node's globals into a DOM-typed project. */
function projectIdFor(root: string | undefined): string | undefined {
  return root === undefined ? undefined : (projectIdForRoot(root) ?? undefined);
}

const adapter: CollectionNotificationAdapter = {
  // MulmoClaude's collection bells publish under its legacy namespace; match it so
  // the shared notifier treats both apps' bells as the same entry.
  pluginPkg: "todo",
  priorityToSeverity,
  // The engine hands these the ROOT the record lives under (core 3.1.0). It becomes an opaque
  // id on the way into the bell, so two projects owning the same slug deep-link to their own.
  buildNavigateTarget: (slug, itemId, root) => buildNavigateTarget(slug, itemId, projectIdFor(root)),
  buildPluginData: ({ legacyId, slug, itemId, priority, root }) => buildPluginData({ legacyId, slug, itemId, priority, project: projectIdFor(root) }),
  readEntry,
};

/** How often the watched set is reconciled against the projects the server knows.
 *
 *  A POLL, because `listProjectRoots` reads a live thunk over `cwdPresets` and nothing
 *  emits when that list changes — launching a terminal from a new directory records one
 *  deep inside the session code. A minute is well under "the user goes looking for the
 *  bell", and a pass over an unchanged list starts and stops nothing. */
const ROOT_SYNC_INTERVAL_MS = 60_000;

// The roots a generation is currently mounted for, in `path.resolve` form — the same
// canonicalisation the package applies at its own claim, so this set and its generation map
// agree on what "already watching" means and a trailing slash cannot mount a second one.
const watchedRoots = new Set<string>();
// Roots whose last start FAILED, so the retry every sync pass does not repeat the warning
// once a minute forever (a project on an unmounted volume would otherwise fill the log).
const failedRoots = new Set<string>();
// Roots whose scoped STOP failed, for the same warn-once reason. Separate from `failedRoots`
// because the two are opposite states: one is not watching and wants to be, the other is still
// watching and must not be.
const failedStops = new Set<string>();
let syncTimer: NodeJS.Timeout | null = null;
// Sync passes are SERIALISED rather than single-flighted: a pass triggered while one is
// running must still run, because it may be the one that sees a newly recorded project.
let queue: Promise<void> = Promise.resolve();

function errorCode(err: unknown): string | undefined {
  return isRecord(err) && typeof err.code === "string" ? err.code : undefined;
}

/** Every root that should have a watcher: the workspace and every saved project directory.
 *
 *  WHY ALL OF THEM rather than "the one the user is looking at": a completion bell is the
 *  notification that the user is NOT looking. Scoping the watchers to the open Collections
 *  pane would mean a project's bell can only ring while its collection is already on screen,
 *  which is the one moment it is not needed. The cost is bounded — discovery mounts a watcher
 *  only for a root that actually HAS collections, and most project directories have none. */
function desiredRoots(): string[] {
  return listProjectRoots().map((project) => path.resolve(project.cwd));
}

async function startRoot(root: string): Promise<void> {
  try {
    // The root is passed EXPLICITLY. The engine host runs in explicit-root mode, so a watcher
    // started without one throws `COLLECTION_ROOT_REQUIRED` on its first discovery.
    await startCollectionWatchers({ discoveryOpts: { workspaceRoot: root } });
    watchedRoots.add(root);
    if (failedRoots.delete(root)) log.info("collection watchers recovered", { root });
  } catch (err) {
    // Branch on the CODE, not the message: "this call forgot its root" is a wiring bug in
    // this file, while anything else is that one directory's problem and must not stop the
    // roots after it in the loop. Both used to land on one log line at the boot call site.
    const code = errorCode(err);
    if (!failedRoots.has(root)) {
      failedRoots.add(root);
      log.warn("collection watchers failed to start for a root — its completion bells are off", {
        root,
        code: code ?? "none",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Warn ONCE that a root would not release, so a stop that keeps failing does not fill the log
 *  at one line a minute. */
function warnStopFailure(root: string, err: unknown): void {
  if (failedStops.has(root)) return;
  failedStops.add(root);
  log.warn("collection watchers failed to stop for a root — retrying next pass", {
    root,
    error: err instanceof Error ? err.message : String(err),
  });
}

/** Release one root's generation, forgetting it only once the package confirms it is gone.
 *
 *  STAYS TRACKED ON FAILURE. The package deletes the generation on the LAST line of its stop, so
 *  a throw can leave one alive — and forgetting the root here would forget the only handle the
 *  next pass has to try again with, leaving a project the server no longer serves watching its
 *  files and publishing bells for the rest of the process's life. A repeat stop is idempotent
 *  (an already-released root is a no-op), so retrying costs nothing. */
async function releaseRoot(root: string): Promise<void> {
  try {
    // Scoped stop: it releases exactly this root's generation and leaves every other project
    // running. A bare `stopCollectionWatchers()` stops them ALL.
    await stopCollectionWatchers({ workspaceRoot: root });
  } catch (err) {
    warnStopFailure(root, err);
    return;
  }
  watchedRoots.delete(root);
  failedRoots.delete(root);
  failedStops.delete(root);
}

/** Drop the retry bookkeeping a pass has made moot: a root that left the list has no start left
 *  to retry, and one that came BACK while its stop was failing is wanted again — so its pending
 *  warning is spent and it must warn afresh if it ever fails to stop later. */
function forgetSpentRetries(desired: Set<string>): void {
  for (const root of failedRoots) if (!desired.has(root)) failedRoots.delete(root);
  for (const root of failedStops) if (desired.has(root)) failedStops.delete(root);
}

/** Reconcile the mounted generations against the current project list: mount one per root the
 *  server now serves, and release the ones it no longer does.
 *
 *  Core 3.1.0 mounts a generation PER ROOT concurrently — each with its own watcher set,
 *  timers and single-flight slots, stamping its root on the bell ids it publishes, which is
 *  what stops two projects' `tasks` collections from deduping into one bell.
 *  `WATCHER_ROOT_CONFLICT` is no longer thrown (the export remains for hosts that catch it). */
async function runRootSync(): Promise<void> {
  const desired = new Set(desiredRoots());
  for (const root of [...watchedRoots]) if (!desired.has(root)) await releaseRoot(root);
  for (const root of desired) if (!watchedRoots.has(root)) await startRoot(root);
  forgetSpentRetries(desired);
}

/** Reconcile the watched roots now. Exported so a caller that KNOWS the project list just
 *  changed can pull the next pass forward instead of waiting out the poll. */
export function syncCollectionWatcherRoots(): Promise<void> {
  queue = queue.catch(() => {}).then(runRootSync);
  return queue;
}

/** Configure the adapter + mount the watchers. Fire-and-forget at boot AFTER
 *  initCollectionsBackend (the engine host) + initNotifier (the delivery sink); a
 *  watcher failure must not abort startup, so the caller attaches `.catch`.
 *
 *  Per-root failures are already contained (see `startRoot`), so what reaches that `.catch`
 *  is only a failure of the pass itself — reading the project list at all. */
export async function startCollectionCompletionWatchers(): Promise<void> {
  configureCollectionWatchers({ adapter, log });
  await syncCollectionWatcherRoots();
  if (syncTimer === null) {
    syncTimer = setInterval(() => {
      void syncCollectionWatcherRoots().catch((err: unknown) => {
        log.warn("collection watcher root sync failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, ROOT_SYNC_INTERVAL_MS);
    // Never hold the process open for the poll — same as the package's own timers.
    syncTimer.unref();
  }
  log.info("collection completion watchers started", { roots: watchedRoots.size });
}

/** Stop every generation and the poll. For test teardown (a leaked timer or watcher crosses
 *  into the next spec file) and for a host that shuts the subsystem down. */
export async function stopCollectionCompletionWatchers(): Promise<void> {
  if (syncTimer !== null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  await queue.catch(() => {});
  await stopCollectionWatchers();
  watchedRoots.clear();
  failedRoots.clear();
  failedStops.clear();
}

/** Test-only: which roots currently have a generation mounted. */
export function watchedCollectionRootsForTesting(): string[] {
  return [...watchedRoots];
}
