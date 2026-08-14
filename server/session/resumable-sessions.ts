// Whether a surviving tmux session can be resumed as a real session.
//
// Shared by the tmux routes (which offer them) and the remote-host bridge (which lists them),
// so it lives here rather than in either. Reads live state — the pty table, the persisted
// dev-terminal set, and both agents' on-disk transcripts — and returns a predicate over ids.

import { claudeOnDiskSessionIds } from "./session-reads.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import { devTerminalSessions, devTerminalSessionsHydrated, ptys } from "./registry.js";
import { isResumableTmuxSession } from "../infra/tmux.js";
/**
 * The snapshots one pass takes, for a caller that needs the same facts to answer its OWN question.
 *
 * The Settings list asks two things of each session — can it be resumed, and what wrote it — and
 * both are answered by the transcript scan below. Handing the sets back means `~/.claude/projects`
 * is walked once per listing instead of once per question (#1478).
 */
export interface ResumableFacts {
  isResumable: (id: string) => boolean;
  claudeOnDisk: ReadonlySet<string>;
  hasCodexRollout: (id: string) => boolean;
}

export const resumableSessionFacts = async (): Promise<ResumableFacts> => {
  await devTerminalSessionsHydrated;
  const live = new Set(ptys.keys());
  const claudeOnDisk = claudeOnDiskSessionIds();
  const codexRoot = codexSessionsRoot();
  const hasCodexRollout = (id: string) => codexRolloutExists(codexRoot, id);
  return {
    isResumable: (id) => isResumableTmuxSession(id, live, devTerminalSessions, claudeOnDisk, hasCodexRollout),
    claudeOnDisk,
    hasCodexRollout,
  };
};

export const resumableSessionPredicate = async (): Promise<(id: string) => boolean> => (await resumableSessionFacts()).isResumable;
