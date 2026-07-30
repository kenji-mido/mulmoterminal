// What the remote-host handlers need from the process around them.
//
// MulmoClaude's handler table is a static const, because its handlers reach their engines through
// module-level imports. Ours cannot be: the workspace, the chat spawner, the attachment ingester
// and every terminal accessor are wired in server/index.ts, where the PTY table lives. So this
// host keeps a FACTORY (see ./index.ts) and passes deps down — a deliberate divergence from the
// reference host, forced by where the state lives rather than by taste.
import type { SessionAgent } from "../../../../common/sessionAgent.js";
import type { IngestResult } from "../ingestAttachments.js";
import type { SessionScreen, TerminalSessionSummary } from "../terminalScreen.js";

export interface RemoteHostHandlerDeps {
  workspace: string;
  // Start a visible chat seeded with `message`; returns the new session id.
  spawnChat: (message: string) => { chatId: string };
  // Download the phone's staged uploads (by storage_id) into the workspace and return
  // path-only attachments plus a deferred staging cleanup (remoteHost/ingestAttachments.ts).
  ingest: (storageIds: string[]) => Promise<IngestResult>;
  // The phone's remote terminal view (#435) — the picker's list and one session's
  // current screen. Wired in server/index.ts, where the PTY table lives.
  listTerminalSessions: () => Promise<TerminalSessionSummary[]>;
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
  // Type into one session's live PTY (#445). Returns false when no PTY is attached
  // in this process — a tmux session that outlived a restart stays viewable but not
  // writable from here.
  writeToSession: (sessionId: string, chunk: string) => boolean;
  // Whether typing may empty the session's input box first, so only the phone's text
  // is submitted (#572). Answered in server/index.ts, where the agent kind and the
  // turn state live.
  canClearBox: (sessionId: string) => boolean;
  // The byte(s) that submit for a given session (#772), read live from config. The phone
  // sends only text; which byte commits it is the host's Claude binding — but only for a
  // Claude session, so this is resolved per session id (shell/codex stay on plain CR).
  submitSequence: (sessionId: string) => string;
  // Which agent runs in a given session, for the completion-menu guard on typed text (#1142).
  // Same lookup as canClearBox / submitSequence: only Claude Code has the menu that eats a
  // submit, and only there is the guard's trailing space not real input.
  sessionAgent: (sessionId: string) => SessionAgent | undefined;
  // Open a new grid terminal in the directory of the session the phone is looking at
  // (#831). Answered in server/index.ts, which owns the PTY table and the pub/sub the
  // grid listens on. Resolves to an error string when it could not be started.
  launchTerminal: (agent: unknown, sessionId: unknown) => { ok: true } | { ok: false; error: string };
}
