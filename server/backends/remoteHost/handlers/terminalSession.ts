// The phone's remote terminal view (#435): pick a session, read its screen, and — since #445 —
// type into it. Screens are bounded by the terminal's own geometry (rows x cols), so unlike
// collections they need no paging to stay under the 1 MiB command-doc ceiling.
//
// No MulmoClaude counterpart: that host has no PTY table to look at.
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { createTerminalInputSender } from "../terminalInput.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

type TerminalSessionDeps = Pick<
  RemoteHostHandlerDeps,
  "listTerminalSessions" | "captureTerminalScreen" | "writeToSession" | "canClearBox" | "submitSequence" | "sessionAgent" | "launchTerminal"
>;

export const createTerminalSessionHandlers = ({
  listTerminalSessions,
  captureTerminalScreen,
  writeToSession,
  canClearBox,
  submitSequence,
  sessionAgent,
  launchTerminal,
}: TerminalSessionDeps): CommandHandlers => {
  // One sender per host, so its per-session ordering actually spans every command.
  const sendInput = createTerminalInputSender({ writeToSession, canClearBox, submitSequence, sessionAgent });
  return {
    listTerminalSessions: async () => toJsonObject({ sessions: await listTerminalSessions() }),

    // `suggestion` is the agent's own dim ghost text — the phone offers it as a chip,
    // since it has no Tab key to accept it with (#563). The screen also carries the
    // session's cwd / branch / summary / prompt when the host knows them, so the phone can
    // head the terminal with what the grid cell shows (#786); the whole SessionScreen is
    // the wire shape, so a field added there reaches the phone without another edit here.
    getTerminalScreen: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      return toJsonObject(await captureTerminalScreen(sessionId));
    },

    // Type a line into the session and press Enter, as if the user were at the
    // keyboard. The phone sends only text; the framing, sanitizing and Enter timing
    // are terminalInput.ts's job.
    sendTerminalInput: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      const text = typeof params.text === "string" ? params.text : "";
      return toJsonObject(await sendInput(sessionId, text));
    },

    // Open a NEW grid terminal in the directory of the session the phone is viewing (#831).
    // The phone names the session, never a path: the host looks the directory up, so a
    // remote client cannot choose where a process starts.
    //
    // Throwing rather than returning the error is what puts the reason on the phone's
    // screen — the command layer turns a rejection into the message it shows, and the
    // most likely failure ("no browser is open") is one the user can act on.
    launchTerminal: async (params: JsonObject) => {
      const result = launchTerminal(params.agent, params.sessionId);
      if (!result.ok) throw new Error(result.error);
      return toJsonObject({ ok: true });
    },
  };
};
