// Starting a grok session in a PTY.
//
// The shortest of the four spawners, and deliberately so: grok takes `--session-id <UUID>` for a
// new conversation, so the id is the one THIS server minted. There is nothing to watch for, nothing
// to claim, and no session->conversation map to keep — the whole apparatus codex and antigravity
// need (a watcher, a `claimed…` set, `remember…`) exists only because those two mint their own ids
// and tell nobody. grok is claude-shaped on this axis; see server/agents/grok-args.ts.
//
// It is antigravity-shaped on the OTHER axis: grok reads its MCP servers from a file in the
// directory rather than from a flag, so that file is brought in line on the way past.
import { grokAdapter } from "../agents/grok.js";
import { buildGrokArgs } from "../agents/grok-args.js";
import { syncGrokMcpConfig } from "../agents/grok-mcp.js";
import { startDirectoryMcpPty, syncDirectoryMcpForSpawn, type SpawnDirectoryMcpPty } from "./spawn-directory-mcp.js";
import { wireAgentPtyRelay } from "./pty-relay.js";
import { seedPromptArgument, withSettingsCleanup } from "./session-settings.js";
import type { SpawnDeps } from "./spawn-deps.js";

// A seed this agent takes as an ARGUMENT cannot carry a newline on Windows, so it may travel in a
// file with the command line naming it instead (#1518, session-settings.ts). Null stays null — the
// builder then places no seed at all.
const seedFor = (sessionId: string, prompt: string | null): string | null => (prompt === null ? null : seedPromptArgument(sessionId, prompt));

export function createGrokSpawner(deps: SpawnDeps) {
  const spawnGrokPty: SpawnDirectoryMcpPty = (sessionId, ws, resumeConversationId, cwd, options) => {
    const { mcpGroups, initialPrompt = null } = options;
    syncDirectoryMcpForSpawn(sessionId, cwd, mcpGroups, syncGrokMcpConfig);

    const args = buildGrokArgs({
      sessionId,
      resume: resumeConversationId,
      model: deps.grokModel,
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
        agent: "grok",
        bin: deps.grokBin,
        binEnvVar: grokAdapter.binEnvVar,
        args,
        resumeConversationId,
      }),
    );

    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps);
    return entry;
  };

  return { spawnGrokPty };
}
