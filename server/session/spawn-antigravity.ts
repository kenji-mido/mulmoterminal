// Starting an Antigravity (`agy`) session in a PTY. Like codex, agy mints its conversation id
// itself, so a fresh session is watched until that id appears — that is what lets a later cold
// reconnect resume it.
import { antigravityAdapter } from "../agents/antigravity.js";
import { buildAntigravityArgs } from "../agents/antigravity-args.js";
import { syncAntigravityMcpConfig } from "../agents/antigravity-mcp.js";
import { syncAntigravitySkillsConfig } from "../agents/antigravity-skills.js";
import { antigravityBrainRoot, snapshotAntigravitySessions, watchForAntigravitySession } from "../agents/antigravity-session.js";
import { startDirectoryMcpPty, syncDirectoryMcpForSpawn, type SpawnDirectoryMcpPty } from "./spawn-directory-mcp.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { seedPromptArgument, withSettingsCleanup } from "./session-settings.js";
import { claimedAntigravityConversations, ptys, rememberAntigravityConversation } from "./registry.js";
import type { SpawnDeps } from "./spawn-deps.js";

// A seed this agent takes as an ARGUMENT cannot carry a newline on Windows, so it may travel in a
// file with the command line naming it instead (#1518, session-settings.ts). Null stays null — the
// builder then places no seed at all.
const seedFor = (sessionId: string, prompt: string | null): string | null => (prompt === null ? null : seedPromptArgument(sessionId, prompt));

export function createAntigravitySpawner(deps: SpawnDeps) {
  function captureAntigravityConversation(sessionId: string, root: string, before: ReadonlySet<string>, cwd: string): void {
    watchForAntigravitySession(root, before, { claimed: claimedAntigravityConversations, isCancelled: () => !ptys.has(sessionId) })
      .then((id) => {
        if (!id) return;
        claimedAntigravityConversations.add(id);
        rememberAntigravityConversation(sessionId, id, cwd);
        // The cell is holding a header badge answered before this id existed — agy names its model
        // in the transcript this mapping points at, and until now there was no transcript to point
        // at. Nothing else will correct it: an agy session has no hooks and no activity tracker, so
        // it never goes working -> idle, and that transition is the cell's only other badge
        // refresh. One push, on the one edge where the answer changed.
        deps.publishActivity(sessionId);
        console.log(`[pty] captured antigravity conversation ${id} for session ${sessionId}`);
      })
      .catch(() => {});
  }

  const spawnAntigravityPty: SpawnDirectoryMcpPty = (sessionId, ws, resumeConversationId, cwd, options) => {
    const { mcpGroups, initialPrompt = null } = options;
    // agy reads its MCP servers from `.agents/mcp_config.json` in the directory rather than from a
    // flag, so that file is brought in line with the groups on the way past: a directory whose
    // switches were flipped before this shipped — or with the `claude mcp` CLI directly — needs no
    // second action to work (#1443).
    syncDirectoryMcpForSpawn(sessionId, cwd, mcpGroups, syncAntigravityMcpConfig);
    // Skills reach agy the same file-in-the-directory way (`.agents/skills.json`) — it cannot
    // read `.claude/skills` on its own, unlike every other agent hosted here. The entries point
    // at the live skill roots, so this is registration, not a mirror to keep fresh.
    syncAntigravitySkillsConfig(cwd);
    // Snapshotted between the sync and the spawn: the capture below tells agy's new conversation
    // from the ones already on disk by the difference, so it must be the world agy is about to find.
    const root = antigravityBrainRoot();
    const before = snapshotAntigravitySessions(root);

    const args = buildAntigravityArgs({
      resume: resumeConversationId,
      model: deps.antigravityModel,
      skipPermissions: true,
      initialPrompt: seedFor(sessionId, initialPrompt),
    });
    // The seed file may already be on disk (seedFor above), and a spawn that throws never reaches
    // reap() — where the cleanup normally happens. Same guarantee spawn-claude takes for its
    // settings file (#579, #1518).
    const { entry, spawnedAtMs } = withSettingsCleanup(sessionId, () =>
      startDirectoryMcpPty({
        sessionId,
        ws,
        cwd,
        agent: "antigravity",
        bin: deps.antigravityBin,
        binEnvVar: antigravityAdapter.binEnvVar,
        args,
        resumeConversationId,
      }),
    );

    if (resumeConversationId) {
      // Recorded on resume too, not just on the spawn that discovered it: a session resumed by the
      // conversation id itself carries no mapping yet, and one whose cell moved needs the new cwd.
      rememberAntigravityConversation(sessionId, resumeConversationId, cwd);
    } else {
      // Only for a FRESH session: on resume the id is already known, and running the watcher could
      // overwrite it with a mis-attributed concurrent conversation.
      captureAntigravityConversation(sessionId, root, before, cwd);
    }

    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps);
    return entry;
  };

  return { spawnAntigravityPty };
}
