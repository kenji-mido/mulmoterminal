// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteRoom, listRooms, postToRoom, readRoom, roomFile, roomsDir } from "../../../server/rooms/rooms";
import { messageLine, messagesSince, parseRoom } from "../../../server/rooms/room-log";
import { MAX_MESSAGE_CHARS } from "../../../common/roomMessage";

let home: string;
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.MULMOTERMINAL_HOME;
  home = mkdtempSync(path.join(tmpdir(), "mt-rooms-"));
  process.env.MULMOTERMINAL_HOME = home;
});
afterEach(() => {
  if (saved === undefined) delete process.env.MULMOTERMINAL_HOME;
  else process.env.MULMOTERMINAL_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

describe("roomFile", () => {
  // The id check is the whole path defence, and it lives HERE so no entry point can skip it.
  it("refuses an id that would leave the rooms directory", () => {
    expect(roomFile("../../etc/passwd")).toBeNull();
    expect(roomFile("a/b")).toBeNull();
  });

  it("puts a room inside the rooms directory", () => {
    expect(roomFile("standup")).toBe(path.join(roomsDir(), "standup.jsonl"));
  });
});

describe("postToRoom / readRoom", () => {
  it("keeps what was said, in the order it was said", () => {
    postToRoom("standup", "#1", "first", 1);
    postToRoom("standup", "#2", "second", 2);
    expect(readRoom("standup").map((m) => [m.from, m.text])).toEqual([
      ["#1", "first"],
      ["#2", "second"],
    ]);
  });

  it("clips a message that would fill a reader's context", () => {
    postToRoom("standup", "#1", "x".repeat(MAX_MESSAGE_CHARS + 100));
    expect(readRoom("standup")[0]?.text).toContain("truncated");
  });

  it("refuses a bad id rather than writing somewhere else", () => {
    expect(postToRoom("../escape", "#1", "hello")).toBeNull();
    expect(existsSync(path.join(home, "..", "escape.jsonl"))).toBe(false);
  });

  it("reads an unknown room as empty — a conversation that has not started is not a failure", () => {
    expect(readRoom("never-used")).toEqual([]);
  });

  // "Nothing has been said" and "I could not find out" are different answers, and they were both
  // being given as an empty conversation — so a caller carried on without history it needed
  // (CodeRabbit review on #1456).
  //
  // Not on Windows: chmod there moves the read-only attribute and nothing else, so `0o000` leaves
  // the file perfectly readable and the read this test needs to fail simply succeeds (#1484).
  it.skipIf(process.platform === "win32")("throws rather than answering empty when the room cannot be read", () => {
    postToRoom("locked", "#1", "secret");
    const file = roomFile("locked");
    if (!file) throw new Error("expected a file");
    chmodSync(file, 0o000);
    try {
      // Running as root defeats the permission bit; the assertion below is what matters and only
      // runs where the bit is honoured.
      let threw = false;
      try {
        readRoom("locked");
      } catch {
        threw = true;
      }
      if (process.getuid?.() !== 0) expect(threw).toBe(true);
    } finally {
      chmodSync(file, 0o600);
    }
  });

  // Append-only, because MULMOTERMINAL_HOME is shared and a room has several writers BY DESIGN —
  // the runner, a human at the CLI, a CI job. A read-merge-write loses whichever finished first.
  it("appends rather than rewriting, so a concurrent writer is not lost", () => {
    postToRoom("standup", "#1", "mine", 1);
    // Somebody else appends straight to the file while we hold an older view of it.
    const file = roomFile("standup");
    if (!file) throw new Error("expected a file");
    writeFileSync(file, readFileSync(file, "utf8") + messageLine({ at: 2, from: "ci", text: "tests passed" }), "utf8");
    postToRoom("standup", "#2", "ours", 3);
    expect(readRoom("standup").map((m) => m.from)).toEqual(["#1", "ci", "#2"]);
  });
});

describe("parseRoom", () => {
  it("drops an unparseable line on its own — a cut-off write costs one message", () => {
    const log = messageLine({ at: 1, from: "#1", text: "a" }) + "\n{ not json" + messageLine({ at: 2, from: "#2", text: "b" });
    expect(parseRoom(log).map((m) => m.text)).toEqual(["a", "b"]);
  });

  // NOT sorted by `at`: two writers can stamp the same millisecond, and a clock that steps
  // backwards would reorder a conversation. The file's order is the one anybody observed.
  it("keeps the file's order even when timestamps disagree", () => {
    const log = messageLine({ at: 99, from: "#1", text: "first anyway" }) + messageLine({ at: 1, from: "#2", text: "second anyway" });
    expect(parseRoom(log).map((m) => m.text)).toEqual(["first anyway", "second anyway"]);
  });
});

describe("messagesSince", () => {
  it("answers only what came after, exclusive", () => {
    const all = parseRoom(messageLine({ at: 1, from: "a", text: "x" }) + messageLine({ at: 2, from: "b", text: "y" }));
    expect(messagesSince(all, 1).map((m) => m.text)).toEqual(["y"]);
    expect(messagesSince(all, 0)).toHaveLength(2);
  });
});

describe("listRooms", () => {
  it("names the rooms that exist, and nothing else in the directory", () => {
    postToRoom("standup", "#1", "hi");
    postToRoom("review", "#1", "hi");
    mkdirSync(path.join(roomsDir(), "notes"), { recursive: true });
    writeFileSync(path.join(roomsDir(), "README.md"), "not a room");
    expect([...listRooms()].sort()).toEqual(["review", "standup"]);
  });

  it("answers nothing before any room exists", () => {
    expect(listRooms()).toEqual([]);
  });

  // By activity, not by name. A table's id starts with the time it was created, so sorting the
  // names put the OLDEST conversation at the top of the list somebody just opened — and a room
  // named by hand sorted wherever its first letter happened to fall.
  it("puts the most recently written room first", () => {
    postToRoom("table-2026-08-01-00-00-00-aaaa", "#1", "old");
    postToRoom("table-2026-08-06-00-00-00-bbbb", "#1", "new");
    const old = roomFile("table-2026-08-01-00-00-00-aaaa");
    const fresh = roomFile("table-2026-08-06-00-00-00-bbbb");
    if (!old || !fresh) throw new Error("both rooms should have a file");
    utimesSync(old, new Date(1000), new Date(1000));
    utimesSync(fresh, new Date(9000), new Date(9000));
    expect(listRooms()).toEqual(["table-2026-08-06-00-00-00-bbbb", "table-2026-08-01-00-00-00-aaaa"]);
  });
});

describe("deleteRoom", () => {
  it("forgets the conversation", () => {
    postToRoom("standup", "#1", "hi");
    expect(deleteRoom("standup")).toBe(true);
    expect(listRooms()).toEqual([]);
    expect(readRoom("standup")).toEqual([]);
  });

  // The caller asked for it to not exist, and it does not. Reporting failure would make a UI
  // refuse to tidy a listing that is already correct.
  it("is happy about a room that was never there", () => {
    expect(deleteRoom("never-existed")).toBe(true);
  });

  it("refuses an id that is not one, rather than resolving a path from it", () => {
    expect(deleteRoom("../../etc/passwd")).toBe(false);
  });
});
