// Starting a `muse` session in a PTY.
//
// Two shapes at once, which is why this is neither spawn-codex.ts nor spawn-grok.ts:
//
//   codex-shaped on the ID axis — muse mints its own session id and tells nobody, so a fresh
//   session is watched until that id appears, which is what lets a later cold reconnect resume it.
//
//   its OWN shape on the MCP axis — muse reaches the GUI tools through a PLUGIN, and a plugin is
//   installed per MACHINE rather than per directory (server/agents/muse-mcp.ts). So the
//   registration is made once and the DIRECTORY's groups travel on the session's environment
//   instead, where the bridge reads them. `mcpGroups` is therefore used here, not written to a file.
import { museAdapter } from "../agents/muse.js";
import { buildMuseArgs } from "../agents/muse-args.js";
import { snapshotMuseSessions, watchForMuseSession } from "../agents/muse-session.js";
import { syncMuseMcpPlugin } from "../agents/muse-mcp.js";
import { musePluginEnv } from "../agents/muse-mcp.js";
import { entitledToolGroups, rememberEntitledToolGroups } from "./bridge-session.js";
import { ptySpawn, ptyWouldReattach } from "./pty-spawn.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { seedPromptArgument, withSettingsCleanup } from "./session-settings.js";
import { claimedMuseSessions, ptys, rememberMuseSession } from "./registry.js";
import type { SpawnDeps } from "./spawn-deps.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDirectoryMcpPty } from "./spawn-directory-mcp.js";

// A seed this agent takes as an ARGUMENT cannot carry a newline on Windows, so it may travel in a
// file with the command line naming it instead (#1518, session-settings.ts). Null stays null — the
// builder then places no seed at all.
const seedFor = (sessionId: string, prompt: string | null): string | null => (prompt === null ? null : seedPromptArgument(sessionId, prompt));

export function createMuseSpawner(deps: SpawnDeps) {
  function captureMuseSession(sessionId: string, cwd: string, before: ReadonlySet<string>): void {
    watchForMuseSession(cwd, before, { claimed: claimedMuseSessions, isCancelled: () => !ptys.has(sessionId) })
      .then((id) => {
        if (!id) return;
        claimedMuseSessions.add(id);
        rememberMuseSession(sessionId, id, cwd);
        deps.publishActivity(sessionId);
        console.log(`[pty] captured muse session ${id} for mulmo session ${sessionId}`);
      })
      .catch(() => {});
  }

  const spawnMusePty: SpawnDirectoryMcpPty = (sessionId, ws, resumeConversationId, cwd, options) => {
    const { mcpGroups, initialPrompt = null } = options;

    // Registered on EVERY path, including a tmux reattach — which is where this differs from the
    // two agents that write a config file in the directory, and the difference is not a detail.
    //
    // Those two must not write on a reattach because the file is shared: rewriting it speaks for
    // every other session in that directory. muse's registration is machine-wide and inert on its
    // own (what a session may reach is decided per session, below), so writing it changes nothing
    // for anyone already running — there is nothing to protect.
    //
    // And skipping it here had a real cost. MulmoTerminal's sessions outlive the server, so after
    // the feature first ships EVERY muse cell is a reattach: the sessions were started before the
    // plugin existed. Gated on `!ptyWouldReattach`, those cells would never register it, and the
    // user restarts the server, sees no tools, and reasonably concludes it is broken (it looked
    // exactly like that on 2026-08-06). Now the reattach registers it too — which still cannot give
    // THAT muse process the tools, since muse reads its plugins at its own start, but the next time
    // the session is started it has them.
    //
    // Not gated on `mcpGroups` being non-empty either: the registration is inert without the
    // entitlement recorded below, and a directory that switches its first group on mid-session
    // would otherwise wait for a spawn that happens to have one already.
    syncMuseMcpPlugin();

    // Snapshot before spawn for fresh sessions. The snapshot is async (sqlite)
    // so we start it BEFORE ptySpawn — otherwise the fire-and-forget read can
    // finish after Muse has already written its row and realBefore already
    // contains the new id, causing watchForMuseSession to exclude it forever.
    // We start the snapshot before ptySpawn to bound the race; awaiting it
    // before spawn would require making this spawner async and changing all
    // callers (ws-routes, plugin-routes, index) to await — a heavy lift that
    // trades a rare first-launch cold-resume miss for a sync-vs-async split
    // across the spawner surface. The `starts-before` ordering keeps the window
    // to ~the SQLite read itself (ms) vs. Muse's row write (100ms+).
    let beforePromise: Promise<Set<string>> | null = null;
    if (!resumeConversationId) {
      beforePromise = snapshotMuseSessions(cwd).catch(() => new Set<string>());
    }

    // The workspace is passed on BOTH paths — a resumed session that loses `--workspace` comes
    // back without the tools it was working with (see muse-args.ts).
    const args = buildMuseArgs({ resume: resumeConversationId, workspace: cwd, model: deps.museModel, initialPrompt: seedFor(sessionId, initialPrompt) });

    // Recorded only when this really STARTS muse. A reattach reaches here too (after a server
    // restart the pty table is empty while the tmux session is not), and the muse in that pane is
    // already running with whatever it read at its own start — so re-recording could only move the
    // entitlement of a session that cannot act on the change (Codex on #1514). The exception is a
    // session this process has no record of at all, which is exactly that server-restart case: the
    // groups are then the only answer available for the bridge to be told.
    //
    // The groups are RECORDED, not exported. A plugin's MCP server inherits nothing from muse
    // (server/session/bridge-session.ts), so the bridge asks this server which session it belongs
    // to and gets this list back with the answer. A session whose directory registered nothing
    // records an empty list and every one of the four servers stands down — the same "no GUI
    // tools" a muse cell had before this was wired.
    if (!ptyWouldReattach(sessionId, true) || entitledToolGroups(sessionId).length === 0) rememberEntitledToolGroups(sessionId, mcpGroups);
    // What the MUSE process itself needs: it does inherit our environment, and without this flag it
    // loads no plugins at all — the registration would be inert rather than absent.
    const env = musePluginEnv();
    // The seed file may already be on disk (seedFor above), and a spawn that throws never reaches
    // reap() — where the cleanup normally happens. Same guarantee spawn-claude takes for its
    // settings file (#579, #1518).
    const { term, tmux, reattached } = withSettingsCleanup(sessionId, () =>
      ptySpawn(sessionId, deps.museBin, args, cwd, true, { env, binEnvVar: museAdapter.binEnvVar }),
    );
    const spawnedAtMs = Date.now();
    const note = resumeConversationId ? `resume ${resumeConversationId}` : null;
    console.log(ptyStartLine({ agent: "muse", pid: term.pid, cwd, tmux, reattached, sessionId, note }));
    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "muse" };
    ptys.set(sessionId, entry);

    if (resumeConversationId) {
      rememberMuseSession(sessionId, resumeConversationId, cwd);
    } else if (beforePromise) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      beforePromise.then((realBefore) => {
        if (!ptys.has(sessionId)) return;
        captureMuseSession(sessionId, cwd, realBefore);
      });
    }

    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps);
    return entry;
  };

  return { spawnMusePty };
}
