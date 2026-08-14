// Which of an agent's OWN conversations each session is running, as it is read from and written
// back to disk. Shared by codex (a rollout id) and antigravity (a conversation id) for the reason
// agent-resume.ts already gives about the read side: the problem is the same for both, and so is
// the answer. Each agent keeps its own file; only the shape is shared.
//
// Both agents mint that id themselves and print it nowhere we can read, so the spawn watcher
// discovers it after the fact. Kept only in memory, the mapping dies with the process: after a
// restart nothing connects a session key to a conversation, and the conversation becomes
// unreachable even though its rollout / brain directory is still sitting on disk.
//
// An APPEND LOG, for the reason the memo log next door spells out: ~/.mulmoterminal is one
// directory for every server on the machine, and launching twice is the ordinary way to get two
// instances. A rewritten snapshot has to be read, merged and written back, and two instances doing
// that at once lose whichever finishes first. Appending needs no read.
//
// Its OWN file rather than a widened id log, the same call dev-terminal-cwds.ts made: those files
// are shared between BUILDS as well as instances, and widening a line format makes an older build's
// parser drop every line of a log it relies on. A file it has never heard of is simply ignored.
//
// One JSON object per line rather than the id log's bare `<id> <value>`: a cwd can contain spaces,
// so there is no separator left to split on.
//
// `conversationId` names codex's rollout id too. The field is what an older build parses, and
// antigravity's log has carried it since 2.9.0 — renaming it per agent would buy a word and cost
// every log already on disk.

export interface AgentConversation {
  sessionId: string;
  conversationId: string;
  cwd: string;
  startedAt: number;
}

/** One line of the log. */
export function agentConversationLine(record: AgentConversation): string {
  return `${JSON.stringify(record)}\n`;
}

/**
 * The record a parsed line holds, or null for anything unusable.
 *
 * Both ids are validated: they become a lookup against the agent's own store and the key a
 * reconnect arrives with. `startedAt` is only ever displayed, so a line missing it is still worth
 * keeping — it is the id mapping that makes the conversation reachable again.
 */
export function agentConversationRecord(parsed: Record<string, unknown>, isValidId: (id: string) => boolean): AgentConversation | null {
  const { sessionId, conversationId, cwd, startedAt } = parsed;
  if (typeof sessionId !== "string" || !isValidId(sessionId)) return null;
  if (typeof conversationId !== "string" || !isValidId(conversationId)) return null;
  if (typeof cwd !== "string" || cwd === "") return null;
  return { sessionId, conversationId, cwd, startedAt: typeof startedAt === "number" ? startedAt : 0 };
}

/**
 * Fold one record into the map: the newest line for a session wins.
 *
 * The log only grows, so a session relaunched somewhere else — or resumed after its conversation
 * was remapped — appends a second line rather than replacing the first.
 */
export function applyAgentConversation(conversations: Map<string, AgentConversation>, record: AgentConversation): void {
  conversations.set(record.sessionId, record);
}

/**
 * Fold a record read at BOOT, leaving alone any session this process has already recorded.
 *
 * Hydration reads the file as it was before our own append could reach it, so for a session
 * spawned while it was still reading, the file's line is older by definition. Overwriting would
 * answer with the conversation and directory that session used to have.
 */
export function hydrateAgentConversationInto(conversations: Map<string, AgentConversation>, written: ReadonlySet<string>, record: AgentConversation): void {
  if (!written.has(record.sessionId)) applyAgentConversation(conversations, record);
}

/**
 * The log read BACKWARDS: every session key that has run a given conversation.
 *
 * The map above answers "what is this session running"; a listing needs the other direction. A row
 * in the launcher's resume list is one of the AGENT's conversation ids, and whether it is safe to
 * open is a question about the MulmoTerminal session holding it — which is a key this log is the
 * only record of. Without it a conversation started from a grid cell reads as free while it is
 * live in that cell, and resuming it starts a second codex on a conversation already running.
 *
 * One conversation, several keys: a session resumed after a restart arrives under a new key and
 * appends a second line, so both keys name it and either one may be the live one.
 */
export function conversationSessionKeys(records: Iterable<AgentConversation>): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const record of records) {
    const known = keys.get(record.conversationId);
    if (known) {
      if (!known.includes(record.sessionId)) known.push(record.sessionId);
    } else {
      keys.set(record.conversationId, [record.sessionId]);
    }
  }
  return keys;
}
