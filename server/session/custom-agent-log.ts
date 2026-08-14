// Which custom agent each session was started on, as it is read from and written back to disk.
//
// It has to OUTLIVE the pty, because the transcript does. A cell started on `ollama launch claude
// …` and then exited leaves a resumable session on disk; picking it up again from "or resume here"
// sends only its id, and a resume deliberately ignores the Agent Picker (see resolveCustomAgent —
// honouring the picker there would move somebody's conversation onto a different model mid-thread).
// So if this mapping died with the process, continuing that session would silently drop it back to
// plain `claude` — the same silent model change, arrived at from the other direction. That is the
// same argument the session memo log next door makes: what the user chose for a session is theirs,
// and resuming the session brings it back.
//
// An APPEND LOG, for the reason those neighbours spell out: ~/.mulmoterminal is one directory for
// every server on the machine, and launching twice is the ordinary way to get two instances. A
// rewritten snapshot has to be read, merged and written back, and two instances doing that at once
// lose whichever finishes first. Appending needs no read.
//
// Its OWN file rather than a widened existing log: these files are shared between BUILDS as well as
// instances, and widening a line format makes an older build's parser drop every line of a log it
// relies on. A file it has never heard of is simply ignored.

export interface CustomAgentSession {
  sessionId: string;
  /** The `customAgents` entry's id. Resolved against the CONFIG at every spawn, so a name here is
   *  a claim about what was picked, never a program to run. */
  agentId: string;
}

/** One line of the log. */
export function customAgentSessionLine(record: CustomAgentSession): string {
  return `${JSON.stringify(record)}\n`;
}

/**
 * The record a parsed line holds, or null for anything unusable.
 *
 * The agent id is checked against the same rule the config accepts, so a line cannot smuggle in a
 * name the picker could never have produced. Nothing here is trusted as a command: the id is only
 * ever looked up in the live config.
 */
export function customAgentSessionRecord(
  parsed: Record<string, unknown>,
  isValidSessionId: (id: string) => boolean,
  isValidAgentId: (id: unknown) => boolean,
): CustomAgentSession | null {
  const { sessionId, agentId } = parsed;
  if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) return null;
  if (typeof agentId !== "string" || !isValidAgentId(agentId)) return null;
  return { sessionId, agentId };
}

/**
 * Fold one record into the map: the newest line for a session wins.
 *
 * The log only grows, so a session relaunched on a different agent appends a second line rather
 * than replacing the first — and reading in file order leaves the last one standing, which is the
 * one that describes how the session runs now.
 */
export function applyCustomAgentSession(sessions: Map<string, string>, record: CustomAgentSession): void {
  sessions.set(record.sessionId, record.agentId);
}
