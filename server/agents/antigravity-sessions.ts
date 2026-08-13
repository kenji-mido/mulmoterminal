// agy's own conversations for a workspace, newest first — the per-project listing that makes a
// past Antigravity conversation findable and resumable, mirroring `/api/codex/sessions`.
//
// The cwd does NOT come from agy. `codex-sessions.ts` next door filters rollouts by the cwd codex
// records in its own session_meta; agy records a conversation's workspace in three places and none
// of them answers "every conversation in this directory": `cache/last_conversations.json` keeps
// only the LAST conversation per cwd and is written at exit, `history.jsonl` has no conversation
// id, and `conversation_summaries.db` has the columns but the CLI never writes a row. So the cwd
// is read from OUR log (session/antigravity-conversations.ts) and agy's transcript is opened only
// for a title and an mtime.
import path from "node:path";
import type { AntigravityConversation } from "../session/antigravity-conversations.js";
import { antigravityConversationExists } from "./antigravity-session.js";
import { cleanTitle, parseJsonRecord, readTranscriptHead } from "./transcript-head.js";

const HEAD_BYTES = 64 * 1024; // the first user turn is step 0, so the head is all a title needs
const SCAN_LIMIT = 200; // newest conversations to touch the filesystem for per request
const DEFAULT_TITLE = "Antigravity session";

// agy wraps the prompt and appends its own blocks, so the raw `content` is not a title:
// `<USER_REQUEST>\n…\n</USER_REQUEST>` then `<ADDITIONAL_METADATA>` (local time) and
// `<USER_SETTINGS_CHANGE>` (a paragraph about the model the user picked).
const USER_REQUEST_RE = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
const APPENDED_BLOCK_RE = /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*?<\/\1>/g;

export interface AntigravitySessionSummary {
  id: string;
  title: string;
  mtime: number;
}

export function antigravityTranscriptPath(root: string, id: string): string {
  return path.join(root, id, ".system_generated", "logs", "transcript.jsonl");
}

// The user's first prompt. Steps that are not user input carry no `content` at all
// (`CONVERSATION_HISTORY`), so the type check alone is not enough.
const isUserInput = (d: Record<string, unknown>): boolean => d.type === "USER_INPUT" && typeof d.content === "string";

function promptText(content: string): string {
  const wrapped = USER_REQUEST_RE.exec(content);
  // No wrapper means a shape we have not seen. Dropping the blocks we DO know keeps a usable
  // title instead of pasting agy's metadata into the row.
  return wrapped?.[1] ?? content.replace(APPENDED_BLOCK_RE, "");
}

/** The conversation's title, from the head of its transcript. */
export function antigravityTitleFromTranscriptHead(head: string): string {
  const first = head
    .split("\n")
    .map(parseJsonRecord)
    .find((d): d is Record<string, unknown> => d !== null && isUserInput(d));
  return cleanTitle(typeof first?.content === "string" ? promptText(first.content) : null, DEFAULT_TITLE);
}

async function readTranscriptSummary(file: string): Promise<{ title: string; mtime: number } | null> {
  const read = await readTranscriptHead(file, HEAD_BYTES);
  return read && { title: antigravityTitleFromTranscriptHead(read.head), mtime: read.mtime };
}

// The newest record per conversation. The log only grows, so one conversation can appear under
// several session keys (a session resumed under a new key) and the same key can appear twice.
function newestPerConversation(records: Iterable<AntigravityConversation>, cwd: string): AntigravityConversation[] {
  const byConversation = new Map<string, AntigravityConversation>();
  for (const record of records) {
    if (record.cwd !== cwd) continue;
    const known = byConversation.get(record.conversationId);
    if (!known || known.startedAt <= record.startedAt) byConversation.set(record.conversationId, record);
  }
  return [...byConversation.values()];
}

/**
 * Antigravity conversations started in `cwd`, newest first.
 *
 * A conversation whose transcript cannot be read is kept, not dropped, as long as its directory is
 * still there: agy creates the directory and the transcript together on the first user input, so an
 * unreadable transcript means the format moved — and a listing that silently returns nothing is worse
 * than one showing a resumable row under a default name.
 *
 * `startedAt` picks the candidates and the transcript's mtime then orders them, so a conversation
 * started long ago but resumed yesterday can fall outside the window once a single directory holds
 * more than `SCAN_LIMIT` of them. That is the trade codex makes too (it bounds by the timestamp in
 * the rollout filename): nothing here can order by recency without reading, and the log grows
 * forever, so an unbounded listing would do unbounded filesystem work on every session-list refresh.
 */
export async function listAntigravitySessions(
  root: string,
  records: Iterable<AntigravityConversation>,
  cwd: string,
  limit: number,
): Promise<AntigravitySessionSummary[]> {
  const live = newestPerConversation(records, cwd)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, SCAN_LIMIT)
    .filter((r) => antigravityConversationExists(root, r.conversationId));
  const summaries = await Promise.all(
    live.map(async (record) => {
      const summary = await readTranscriptSummary(antigravityTranscriptPath(root, record.conversationId));
      return { id: record.conversationId, title: summary?.title ?? DEFAULT_TITLE, mtime: summary?.mtime ?? record.startedAt };
    }),
  );
  // toSorted, not sort: sort mutates and returns the SAME array, so reading the return value
  // reads like a copy when it is not (sonarjs/no-misleading-array-reverse).
  return summaries.toSorted((a, b) => b.mtime - a.mtime).slice(0, limit);
}
