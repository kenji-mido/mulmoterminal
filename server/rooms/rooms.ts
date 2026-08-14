// Rooms on disk: where they live, and the two things anybody does with one (#1456).
//
// A room is the conversation itself, kept apart from the agents having it. That is what lets a
// human at the CLI, a CI job, and the round-table runner all take part in the same exchange — and
// what lets the conversation outlive the browser tab that started it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { messageLine, parseRoom } from "./room-log.js";
import { clipMessage, isRoomId, type RoomMessage } from "../../common/roomMessage.js";

const ROOMS_DIR = "rooms";
const ROOM_EXT = ".jsonl";

/** Where rooms live. A function, not a constant, so MULMOTERMINAL_HOME redirects it the way it
 *  redirects everything else this app persists. */
export const roomsDir = (): string => path.join(mulmoterminalHome(), ROOMS_DIR);

/** The file for a room, or null when the id is not one.
 *
 *  The id check is the WHOLE path defence, so it happens here rather than being assumed of the
 *  caller: `isRoomId` allows no separator and no dot, so the join cannot leave the directory.
 *  Every entry point goes through this function for that reason. */
export function roomFile(room: string): string | null {
  return isRoomId(room) ? path.join(roomsDir(), `${room}${ROOM_EXT}`) : null;
}

/** Everything said in a room, oldest first.
 *
 *  A room that does not exist is EMPTY; a room that cannot be read THROWS. Those are different
 *  answers and were being given the same one: a permission error came back as an empty
 *  conversation, so a caller could not tell "nothing has been said" from "I could not find out",
 *  and would carry on without history it needed (CodeRabbit review on #1456).
 *
 *  Bounded by how much was posted, which is capped per message and written only by this machine's
 *  own tools — but a room is a CONVERSATION, and those grow. Read whole for now; if a room ever
 *  needs to outgrow memory it wants a tail read, not a bigger buffer. */
export function readRoom(room: string): RoomMessage[] {
  const file = roomFile(room);
  if (!file) return [];
  if (!existsSync(file)) return [];
  return parseRoom(readFileSync(file, "utf8"));
}

/** Append one message. Returns what was stored (the text may have been clipped), or null when the
 *  room id is not one — so a caller can answer 400 rather than guessing. */
export function postToRoom(room: string, from: string, text: string, at: number = Date.now()): RoomMessage | null {
  const file = roomFile(room);
  if (!file) return null;
  const message: RoomMessage = { at, from, text: clipMessage(text) };
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, messageLine(message), "utf8");
    return message;
  } catch (err) {
    console.warn(`[rooms] could not post to ${room}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** When a room was last written to, or 0 if that cannot be told — which sorts it last rather than
 *  dropping it from the listing. A room you cannot stat is still a room. */
function lastWrittenAt(room: string): number {
  try {
    const file = roomFile(room);
    return file ? statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}

/** The rooms that exist, newest activity first. Reads names and mtimes only — a listing that
 *  parsed every room would cost the whole history of every conversation to answer "which ones are
 *  there".
 *
 *  Ordered by mtime rather than by name: a table's id starts with the time it was created, so
 *  sorting the names put the oldest conversation at the top of the list, and a room somebody named
 *  themselves sorted wherever its first letter fell. */
export function listRooms(): string[] {
  try {
    // The only swallowed failure here is the directory not existing yet, which is the ordinary
    // state before anybody has started a conversation.
    return readdirSync(roomsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(ROOM_EXT))
      .map((entry) => entry.name.slice(0, -ROOM_EXT.length))
      .filter(isRoomId)
      .map((room) => ({ room, at: lastWrittenAt(room) }))
      .sort((a, b) => b.at - a.at || a.room.localeCompare(b.room))
      .map((entry) => entry.room);
  } catch {
    return [];
  }
}

/** Forget a conversation. True when the room is gone afterwards — including when it was never
 *  there, since the caller asked for it to not exist and it does not.
 *
 *  Every table mints a room, so without this the directory only grows; a listing nobody can tidy
 *  is what makes people stop opening it. */
export function deleteRoom(room: string): boolean {
  const file = roomFile(room);
  if (!file) return false;
  try {
    rmSync(file, { force: true });
    return true;
  } catch (err) {
    console.warn(`[rooms] could not delete ${room}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
