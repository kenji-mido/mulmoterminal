// Talking to a conversation room from the browser (#1456).
//
// Thin on purpose: the interesting decisions — what a window is, how a room reads to an agent —
// are pure and live in `common/roomMessage.ts`, so both this and the server render the same thing.
//
// Each operation comes in two forms, and the pair is the point. The `load*` / `send*` form answers
// whether it worked; the `fetch*` / `post*` form throws that answer away. Both are wanted, by
// different callers: the round-table runner is mid-conversation and must not stop because one
// request dropped, while a person watching a room must not be shown an empty conversation when the
// truth is "could not read it". One HTTP call site, two policies, neither hidden inside the other.
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import type { RoomMessage } from "../../common/roomMessage";

const REQUEST_TIMEOUT_MS = 10_000;

const isRoomMessage = (value: unknown): value is RoomMessage =>
  isRecord(value) && typeof value.at === "number" && typeof value.from === "string" && typeof value.text === "string";

/** What a read came back with. `ok: false` is "I could not find out", which is not the same answer
 *  as an empty conversation and must not be rendered as one. */
export type RoomRead = { ok: true; messages: RoomMessage[] } | { ok: false };

const roomPath = (room: string): string => `/api/rooms/${encodeURIComponent(room)}`;

/** Everything said in a room since `since`, or the failure. */
export async function loadRoom(room: string, since = 0): Promise<RoomRead> {
  try {
    const res = await fetchWithTimeout(`${roomPath(room)}?since=${since}`, {}, REQUEST_TIMEOUT_MS);
    if (!res.ok) return { ok: false };
    const data = await jsonBody(res);
    return { ok: true, messages: isUnknownArray(data.messages) ? data.messages.filter(isRoomMessage) : [] };
  } catch {
    return { ok: false };
  }
}

/** The rooms that exist, newest activity first (the server decides the order). */
export async function listRooms(): Promise<string[]> {
  try {
    const res = await fetchWithTimeout("/api/rooms", {}, REQUEST_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = await jsonBody(res);
    return isUnknownArray(data.rooms) ? data.rooms.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/** Append one message. False means it did not reach the room. */
export async function sendRoomMessage(room: string, from: string, text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    const res = await fetchWithTimeout(
      roomPath(room),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, text }) },
      REQUEST_TIMEOUT_MS,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Forget a conversation. False means it is still there. */
export async function deleteRoom(room: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(roomPath(room), { method: "DELETE" }, REQUEST_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}

/** The runner's read: an unreachable server answers an empty conversation rather than throwing.
 *  The caller is mid-table, and losing the record is not a reason to stop the table. */
export async function fetchRoom(room: string, since = 0): Promise<RoomMessage[]> {
  const read = await loadRoom(room, since);
  return read.ok ? read.messages : [];
}

/** The runner's post. Swallows failure for the reason above — a room that cannot be written is a
 *  lost record, not a lost conversation. A person's own post goes through `sendRoomMessage`, which
 *  says whether it landed. */
export async function postRoomMessage(room: string, from: string, text: string): Promise<void> {
  await sendRoomMessage(room, from, text);
}
