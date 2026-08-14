// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MAX_MESSAGE_CHARS, WINDOW_CHARS, WINDOW_MESSAGES, clipMessage, formatRoom, isRoomId, roomWindow, type RoomMessage } from "../../common/roomMessage";
import { answersOurSend } from "../../src/composables/exchangeRules";

const said = (from: string, text: string, at = 1): RoomMessage => ({ at, from, text });

describe("isRoomId", () => {
  // The id becomes a FILENAME, so this is the whole path defence.
  it("refuses anything that could leave the rooms directory", () => {
    expect(isRoomId("..")).toBe(false);
    expect(isRoomId("../etc/passwd")).toBe(false);
    expect(isRoomId("a/b")).toBe(false);
    expect(isRoomId("a.b")).toBe(false);
    expect(isRoomId("")).toBe(false);
    expect(isRoomId(null)).toBe(false);
  });

  // Lowercase only: a case-insensitive filesystem would otherwise make one file answer to two ids.
  it("refuses uppercase, so one file cannot have two names", () => {
    expect(isRoomId("Room")).toBe(false);
    expect(isRoomId("room")).toBe(true);
  });

  it("accepts the shape the runner generates", () => {
    expect(isRoomId("table-2026-08-06-04-12-33")).toBe(true);
  });

  it("refuses an id too long to be a comfortable filename", () => {
    expect(isRoomId("a".repeat(64))).toBe(true);
    expect(isRoomId("a".repeat(65))).toBe(false);
  });
});

describe("clipMessage", () => {
  it("keeps a normal message whole", () => {
    expect(clipMessage("hello")).toBe("hello");
  });

  // A room is read INTO an agent's context, so one post must not be able to fill it — and the
  // result has to respect the limit it declares, mark included (CodeRabbit review on #1456).
  it("cuts a message to AT MOST the limit, counting the truncation mark", () => {
    const clipped = clipMessage("x".repeat(MAX_MESSAGE_CHARS + 500));
    expect(clipped).toContain("truncated");
    expect([...clipped].length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  // Code points, not UTF-16 units — a limit must mean the same thing for Japanese as for English.
  it("counts characters, not UTF-16 units", () => {
    expect(clipMessage("あ".repeat(10), 10)).toBe("あ".repeat(10));
    expect(clipMessage("あ".repeat(11), 10)).toContain("truncated");
  });
});

describe("roomWindow", () => {
  it("keeps the whole conversation while it is short", () => {
    const all = [said("#1", "a"), said("#2", "b"), said("#3", "c")];
    expect(roomWindow(all)).toEqual(all);
  });

  // Drops the OLDEST: a speaker needs what was just said far more than how it opened.
  it("keeps the most recent when there are too many", () => {
    const many = Array.from({ length: WINDOW_MESSAGES + 5 }, (_, i) => said("#1", `m${i}`, i));
    const window = roomWindow(many);
    expect(window).toHaveLength(WINDOW_MESSAGES);
    expect(window.at(-1)?.text).toBe(`m${WINDOW_MESSAGES + 4}`);
  });

  it("stops on total length too, oldest first", () => {
    const long = [said("#1", "x".repeat(WINDOW_CHARS)), said("#2", "recent")];
    expect(roomWindow(long).map((m) => m.text)).toEqual(["recent"]);
  });

  // One message over the whole budget is still handed over: an empty window would tell the next
  // speaker nothing was said, which is worse than a long read.
  it("never returns nothing when there is something to say", () => {
    expect(roomWindow([said("#1", "y".repeat(WINDOW_CHARS * 3))])).toHaveLength(1);
  });
});

describe("formatRoom", () => {
  const room = [said("#1 · claude", "mock the filesystem"), said("#2 · codex", "no, use a temp dir")];

  it("names every speaker — with three seats, who said it is the point", () => {
    const text = formatRoom(room);
    expect(text).toContain("#1 · claude");
    expect(text).toContain("#2 · codex");
    expect(text).toContain("mock the filesystem");
  });

  // Same framing a two-cell handoff uses: the reader is an agent, and a transcript of other agents
  // would otherwise read as instructions addressed to it.
  it("says the block is a record, not instructions", () => {
    expect(formatRoom(room)).toContain("RECORD");
  });

  it("says nothing about an empty room", () => {
    expect(formatRoom([])).toBe("");
  });

  // The v1 trap, unchanged here: `answersOurSend` correlates on the TAIL of what was submitted, so
  // the conversation has to be last. Two rounds whose newest message differs must not correlate.
  it("puts the conversation last, so consecutive rounds do not correlate", () => {
    const round1 = formatRoom([...room]);
    const round2 = formatRoom([...room, said("#3 · claude", "both, at different layers")]);
    expect(answersOurSend(round1, round2)).toBe(false);
    expect(answersOurSend(round2, round1)).toBe(false);
  });
});
