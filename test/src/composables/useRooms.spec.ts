import { describe, it, expect, beforeEach, vi } from "vitest";
import { deleteRoom, fetchRoom, listRooms, loadRoom, postRoomMessage, sendRoomMessage } from "../../../src/composables/useRooms";

// Every call to the room API comes in two forms, and the PAIR is what these tests are about: one
// says whether it worked, one throws that answer away. Both are wanted, by different callers — the
// round-table runner is mid-conversation and must not stop for one dropped request, while a person
// watching a room must not be shown an empty conversation when the truth is "could not read it".

interface Sent {
  url: string;
  method: string;
  body: unknown;
}
let sent: Sent[] = [];
let reply: { ok: boolean; body?: unknown };

beforeEach(() => {
  sent = [];
  reply = { ok: true, body: { messages: [] } };
  globalThis.fetch = vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    sent.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: reply.ok, status: reply.ok ? 200 : 500, json: async () => reply.body ?? {} };
  }) as unknown as typeof fetch;
});

describe("loadRoom", () => {
  it("answers what was said", async () => {
    reply = { ok: true, body: { messages: [{ at: 1, from: "#1", text: "hi" }] } };
    expect(await loadRoom("standup")).toEqual({ ok: true, messages: [{ at: 1, from: "#1", text: "hi" }] });
  });

  // The distinction #1476 taught the server to make, kept intact on this side. An unreadable room
  // is not an empty one, and a person is even less able to tell the two apart than the runner was.
  it("says it could not read, rather than answering an empty conversation", async () => {
    reply = { ok: false };
    expect(await loadRoom("standup")).toEqual({ ok: false });
  });

  it("drops anything in the reply that is not a message", async () => {
    reply = { ok: true, body: { messages: [{ at: 1, from: "#1", text: "hi" }, { nonsense: true }, "also nonsense"] } };
    const read = await loadRoom("standup");
    expect(read.ok && read.messages).toHaveLength(1);
  });

  it("asks only for what came after `since`", async () => {
    await loadRoom("standup", 42);
    expect(sent[0]?.url).toContain("since=42");
  });

  it("escapes the room in the path", async () => {
    await loadRoom("a b");
    expect(sent[0]?.url).toBe("/api/rooms/a%20b?since=0");
  });
});

describe("fetchRoom — the runner's read", () => {
  // Deliberately the forgiving one: the caller is mid-table, and losing the record is not a reason
  // to stop a live conversation.
  it("answers an empty conversation when the room cannot be read", async () => {
    reply = { ok: false };
    expect(await fetchRoom("standup")).toEqual([]);
  });
});

describe("sendRoomMessage", () => {
  it("posts what was said", async () => {
    expect(await sendRoomMessage("standup", "human", "morning")).toBe(true);
    expect(sent[0]).toMatchObject({ url: "/api/rooms/standup", method: "POST", body: { from: "human", text: "morning" } });
  });

  // A post that vanished from the screen without reaching the room is the one outcome a person
  // cannot recover from, so this form has to be able to say so.
  it("says a post did not land", async () => {
    reply = { ok: false };
    expect(await sendRoomMessage("standup", "human", "morning")).toBe(false);
  });

  it("refuses to post nothing", async () => {
    expect(await sendRoomMessage("standup", "human", "   ")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("postRoomMessage — the runner's post", () => {
  it("does not throw when the post fails", async () => {
    reply = { ok: false };
    await expect(postRoomMessage("standup", "#1", "hi")).resolves.toBeUndefined();
  });
});

describe("listRooms / deleteRoom", () => {
  it("lists names, ignoring anything that is not one", async () => {
    reply = { ok: true, body: { rooms: ["standup", 7, null] } };
    expect(await listRooms()).toEqual(["standup"]);
  });

  it("answers nothing rather than throwing when the list cannot be fetched", async () => {
    reply = { ok: false };
    expect(await listRooms()).toEqual([]);
  });

  it("deletes, and says whether the room is gone", async () => {
    expect(await deleteRoom("standup")).toBe(true);
    expect(sent[0]).toMatchObject({ url: "/api/rooms/standup", method: "DELETE" });
    reply = { ok: false };
    expect(await deleteRoom("standup")).toBe(false);
  });
});
