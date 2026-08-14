// A room on disk, as a pure format (#1456).
//
// APPEND-ONLY, for the reason worktree-env-log.ts and session-tool-groups.ts are: MULMOTERMINAL_HOME
// is shared by every server on this machine, and a room is written by more than one writer by
// design — the runner, a human at the CLI, a CI job. A read-merge-write would lose whichever post
// finished first, which for a conversation means a message that was accepted and then silently
// vanished.
//
// One JSON object per line. A line that does not parse is dropped on its own: a file cut off
// mid-append costs the last post, never the ones before it.
import { isRecord } from "../../common/isRecord.js";
import type { RoomMessage } from "../../common/roomMessage.js";

/** The newline LEADS rather than trails, like session-id-log.ts: whatever the file ended with, an
 *  appended post starts its own line, so a truncated write costs one message and not the next. */
export const messageLine = (message: RoomMessage): string => `\n${JSON.stringify(message)}`;

const isMessage = (raw: unknown): raw is RoomMessage =>
  isRecord(raw) && typeof raw.at === "number" && typeof raw.from === "string" && typeof raw.text === "string";

function parsedLine(line: string): RoomMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw: unknown = JSON.parse(trimmed);
    return isMessage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Everything the room holds, in the order it was said.
 *
 *  NOT sorted by `at`: two writers on one machine can stamp the same millisecond, and a clock that
 *  steps backwards would reorder a conversation. The file's own order is what was actually
 *  appended, which is the only ordering anybody observed. */
export const parseRoom = (contents: string): RoomMessage[] => contents.split("\n").flatMap((line) => parsedLine(line) ?? []);

/** The messages appended after `since` (epoch ms, exclusive). Filtered on the parsed list rather
 *  than while reading, so the ordering rule above holds for a partial read too. */
export const messagesSince = (messages: readonly RoomMessage[], since: number): RoomMessage[] => messages.filter((message) => message.at > since);
