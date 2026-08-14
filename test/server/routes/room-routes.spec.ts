// @vitest-environment node
// The /api/rooms contract, pinned at the route. Two things matter here and nowhere else: the room
// id reaches a FILE PATH, and posting writes into a file every agent in a running table then reads
// — so a page on another origin must not be able to put words in the conversation (#1456).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountRoomRoutes } from "../../../server/routes/room-routes";
import { postToRoom, roomFile } from "../../../server/rooms/rooms";

const app = express();
app.use(express.json());
mountRoomRoutes(app, { isAllowedOrigin: () => allowOrigin });
let allowOrigin = true;

let home: string;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.MULMOTERMINAL_HOME;
  home = mkdtempSync(path.join(tmpdir(), "mt-room-route-"));
  process.env.MULMOTERMINAL_HOME = home;
  allowOrigin = true;
});
afterEach(() => {
  if (saved === undefined) delete process.env.MULMOTERMINAL_HOME;
  else process.env.MULMOTERMINAL_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

describe("GET /api/rooms/:room", () => {
  it("answers what was said", async () => {
    postToRoom("standup", "#1", "morning", 1);
    const res = await request(app).get("/api/rooms/standup");
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(["morning"]);
  });

  it("answers only what came after `since`", async () => {
    postToRoom("standup", "#1", "old", 1);
    postToRoom("standup", "#2", "new", 5);
    const res = await request(app).get("/api/rooms/standup").query({ since: "1" });
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(["new"]);
  });

  // A garbage `since` reads as "from the beginning": the caller gets more than it asked for, never
  // a room that looks empty.
  it("treats an unusable `since` as the beginning", async () => {
    postToRoom("standup", "#1", "hello", 1);
    const res = await request(app).get("/api/rooms/standup").query({ since: "not-a-number" });
    expect(res.body.messages).toHaveLength(1);
  });

  it("refuses an id that is not one", async () => {
    expect((await request(app).get("/api/rooms/Not%20A%20Room")).status).toBe(400);
  });

  it("answers an empty conversation for a room nobody has used", async () => {
    const res = await request(app).get("/api/rooms/quiet");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  // A read failure must NOT look like an empty conversation, or the caller carries on without
  // history it needed (CodeRabbit review on #1456).
  //
  // Not on Windows: chmod there moves the read-only attribute and nothing else, so `0o000` leaves
  // the file perfectly readable and the read this test needs to fail simply succeeds (#1484).
  it.skipIf(process.platform === "win32")("answers 500 rather than 200-with-nothing when the room cannot be read", async () => {
    postToRoom("locked", "#1", "secret");
    const file = roomFile("locked");
    if (!file) throw new Error("expected a file");
    chmodSync(file, 0o000);
    try {
      const res = await request(app).get("/api/rooms/locked");
      if (process.getuid?.() !== 0) expect(res.status).toBe(500);
    } finally {
      chmodSync(file, 0o600);
    }
  });
});

describe("POST /api/rooms/:room", () => {
  const post = (room: string, body: Record<string, unknown>) => request(app).post(`/api/rooms/${room}`).send(body);

  it("stores a message and says what it stored", async () => {
    const res = await post("standup", { from: "#2 · codex", text: "tests pass" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ from: "#2 · codex", text: "tests pass" });
    expect((await request(app).get("/api/rooms/standup")).body.messages).toHaveLength(1);
  });

  // The guard matters more here than on most routes: this writes into a file that every agent in a
  // running table reads on its next turn.
  it("refuses a cross-origin post", async () => {
    allowOrigin = false;
    expect((await post("standup", { from: "x", text: "hi" })).status).toBe(403);
    expect((await request(app).get("/api/rooms/standup")).body.messages).toEqual([]);
  });

  it("refuses an id that is not one, rather than writing somewhere else", async () => {
    expect((await post("..%2Fescape", { from: "x", text: "hi" })).status).toBe(400);
  });

  it("refuses an empty message", async () => {
    expect((await post("standup", { from: "x", text: "   " })).status).toBe(400);
    expect((await post("standup", { from: "x" })).status).toBe(400);
  });

  // A post that reached the room matters more than its label.
  it("falls back to a name rather than refusing an unnamed post", async () => {
    const res = await post("standup", { text: "who said this" });
    expect(res.body.message.from).toBeTruthy();
  });
});

describe("GET /api/rooms", () => {
  it("lists the rooms that exist", async () => {
    postToRoom("alpha", "#1", "a");
    postToRoom("beta", "#1", "b");
    expect([...(await request(app).get("/api/rooms")).body.rooms].sort()).toEqual(["alpha", "beta"]);
  });
});

describe("DELETE /api/rooms/:room", () => {
  it("forgets the conversation", async () => {
    postToRoom("standup", "#1", "morning");
    expect((await request(app).delete("/api/rooms/standup")).status).toBe(200);
    expect((await request(app).get("/api/rooms")).body.rooms).toEqual([]);
  });

  // Guarded like the post, and then some: this one destroys a record rather than adding to one.
  it("refuses a cross-origin delete", async () => {
    postToRoom("standup", "#1", "morning");
    allowOrigin = false;
    expect((await request(app).delete("/api/rooms/standup")).status).toBe(403);
    expect((await request(app).get("/api/rooms")).body.rooms).toEqual(["standup"]);
  });

  it("refuses an id that is not one, rather than resolving a path from it", async () => {
    expect((await request(app).delete("/api/rooms/..%2Fescape")).status).toBe(400);
  });
});
