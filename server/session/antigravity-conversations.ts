// Which agy conversation each antigravity session is running, as it is read from and written back
// to disk.
//
// agy mints the conversation id itself and prints it nowhere we can read, so the spawn watcher
// discovers it after the fact (agents/antigravity-session.ts). Kept only in memory, that mapping
// dies with the process: after a restart nothing connects a session key to a conversation, and the
// conversation becomes unreachable even though its directory is still sitting in agy's brain root.
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

export interface AntigravityConversation {
  sessionId: string;
  conversationId: string;
  cwd: string;
  startedAt: number;
}

/** One line of the log. */
export function antigravityConversationLine(record: AntigravityConversation): string {
  return `${JSON.stringify(record)}\n`;
}

/**
 * The record a parsed line holds, or null for anything unusable.
 *
 * Both ids are validated: they become a filename lookup under agy's brain root and the key a
 * reconnect arrives with. `startedAt` is only ever displayed, so a line missing it is still worth
 * keeping — it is the id mapping that makes the conversation reachable again.
 */
export function antigravityConversationRecord(parsed: Record<string, unknown>, isValidId: (id: string) => boolean): AntigravityConversation | null {
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
export function applyAntigravityConversation(conversations: Map<string, AntigravityConversation>, record: AntigravityConversation): void {
  conversations.set(record.sessionId, record);
}

/**
 * Fold a record read at BOOT, leaving alone any session this process has already recorded.
 *
 * Hydration reads the file as it was before our own append could reach it, so for a session
 * spawned while it was still reading, the file's line is older by definition. Overwriting would
 * answer with the conversation and directory that session used to have.
 */
export function hydrateAntigravityConversationInto(
  conversations: Map<string, AntigravityConversation>,
  written: ReadonlySet<string>,
  record: AntigravityConversation,
): void {
  if (!written.has(record.sessionId)) applyAntigravityConversation(conversations, record);
}
