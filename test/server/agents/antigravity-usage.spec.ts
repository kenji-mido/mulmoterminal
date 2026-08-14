// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { antigravityBadgesFromDb, antigravityDbPath } from "../../../server/agents/antigravity-usage.js";

// agy's accounting, which lives in a SQLite database of protobuf blobs and NOT in the transcript
// (see the file's header for the measurements the field numbers come from). Everything here is
// about the same rule: a database that is not exactly the shape measured must produce no badge at
// all. Half a reading is a wrong number on a header a user compacts by.

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
};
const key = (field: number, wireType: number) => varint(field * 8 + wireType);
const v = (field: number, value: number): number[] => [...key(field, 0), ...varint(value)];
const msg = (field: number, body: number[]): number[] => [...key(field, 2), ...varint(body.length), ...body];

interface Gen {
  used?: number;
  window?: number;
  prompt?: number;
  output?: number;
  cached?: number;
  toolPrompt?: number;
  thinking?: number;
}

/** One `gen_metadata` row in agy's real nesting: usage under 1.4, the context reading under
 *  1.9.10. A field left out of `gen` is left out of the blob, as agy leaves out a cache count on
 *  the first generation of a conversation. */
const genRow = (gen: Gen): Buffer => {
  const usage = [
    ...(gen.prompt === undefined ? [] : v(2, gen.prompt)),
    ...(gen.output === undefined ? [] : v(3, gen.output)),
    ...(gen.cached === undefined ? [] : v(5, gen.cached)),
    ...(gen.toolPrompt === undefined ? [] : v(9, gen.toolPrompt)),
    ...(gen.thinking === undefined ? [] : v(10, gen.thinking)),
  ];
  const context = [...(gen.used === undefined ? [] : v(1, gen.used)), ...(gen.window === undefined ? [] : v(4, gen.window))];
  return Buffer.from(msg(1, [...v(3, 1071), ...msg(4, usage), ...msg(9, [...msg(10, context)])]));
};

const CONVERSATION = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";

describe("antigravityBadgesFromDb", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mt-agy-usage-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** A real database, written the way agy's is: one blob per generation, oldest first. */
  const writeDb = (rows: Buffer[], conversation = CONVERSATION) => {
    const db = new DatabaseSync(antigravityDbPath(root, conversation));
    db.exec("create table gen_metadata (idx integer primary key, data blob, size integer not null default 0)");
    const insert = db.prepare("insert into gen_metadata (idx, data, size) values (?, ?, ?)");
    rows.forEach((data, idx) => insert.run(idx, data, data.length));
    db.close();
  };

  // The numbers in this fixture are the ones measured on the real conversation, so a change to the
  // field constants breaks here rather than on someone's header.
  it("reads the newest context reading and the cumulative token totals", async () => {
    writeDb([
      genRow({ used: 2522, window: 256_000, prompt: 22_812, output: 178, toolPrompt: 98, thinking: 80 }),
      genRow({ used: 234_987, window: 256_000, prompt: 4901, output: 180, cached: 227_183, toolPrompt: 15, thinking: 94 }),
    ]);
    const badges = await antigravityBadgesFromDb(root, CONVERSATION);

    expect(badges?.context).toEqual({ contextTokens: 234_987, contextWindow: 256_000 });
    expect(badges?.usage).toEqual({
      inputTokens: 22_812 + 98 + 4901 + 15,
      outputTokens: 178 + 80 + 180 + 94,
      cacheReadTokens: 227_183,
      cacheCreationTokens: 0,
    });
  });

  // The last row of the table is not always a generation — a conversation can end with a
  // configuration record, which is where the real data's last row landed.
  it("looks past trailing rows that carry no reading", async () => {
    writeDb([genRow({ used: 199_141, window: 256_000, prompt: 2485, output: 255 }), Buffer.from(msg(3, [...v(13, 1)])), Buffer.from(msg(3, [...v(13, 1)]))]);
    expect((await antigravityBadgesFromDb(root, CONVERSATION))?.context).toEqual({ contextTokens: 199_141, contextWindow: 256_000 });
  });

  it("counts a generation with no cache read, and skips a row that is not a generation", async () => {
    writeDb([genRow({ prompt: 1000, output: 10 }), Buffer.from(msg(3, [...v(13, 1)]))]);
    const badges = await antigravityBadgesFromDb(root, CONVERSATION);
    expect(badges?.usage.inputTokens).toBe(1000);
    expect(badges?.usage.cacheReadTokens).toBe(0);
  });

  describe("refuses a reading rather than reporting a wrong one", () => {
    it("when the context value is larger than its own window", async () => {
      writeDb([genRow({ used: 300_000, window: 256_000, prompt: 100, output: 1 })]);
      const badges = await antigravityBadgesFromDb(root, CONVERSATION);
      expect(badges?.context).toEqual({ contextTokens: 0, contextWindow: null }); // usage survives; the reading does not
      expect(badges?.usage.inputTokens).toBe(100);
    });

    it("when the window is too small to be one", async () => {
      writeDb([genRow({ used: 5, window: 24, prompt: 100, output: 1 })]);
      expect((await antigravityBadgesFromDb(root, CONVERSATION))?.context).toEqual({ contextTokens: 0, contextWindow: null });
    });

    it("when a token count is impossible", async () => {
      writeDb([genRow({ used: 1000, window: 256_000, prompt: 100, output: 5_000_000_000 })]);
      expect((await antigravityBadgesFromDb(root, CONVERSATION))?.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
    });

    it("when the fields have moved", async () => {
      // The same numbers, one level shallower — what a renumbering looks like from here.
      writeDb([Buffer.from(msg(1, [...msg(4, [...v(7, 4901)]), ...msg(9, [...msg(11, [...v(1, 234_987), ...v(4, 256_000)])])]))]);
      expect(await antigravityBadgesFromDb(root, CONVERSATION)).toBeNull();
    });
  });

  it("answers null for a conversation with no database, an empty one, and a file that is not one", async () => {
    expect(await antigravityBadgesFromDb(root, CONVERSATION)).toBeNull();

    writeDb([]);
    expect(await antigravityBadgesFromDb(root, CONVERSATION)).toBeNull();

    const junk = "b2dab7a3-d613-4292-8308-47bef12eeccd";
    fs.writeFileSync(antigravityDbPath(root, junk), "this is not a database");
    expect(await antigravityBadgesFromDb(root, junk)).toBeNull();
  });

  it("answers null for a database without the table it reads", async () => {
    const db = new DatabaseSync(antigravityDbPath(root, CONVERSATION));
    db.exec("create table steps (idx integer primary key, data blob)");
    db.close();
    expect(await antigravityBadgesFromDb(root, CONVERSATION)).toBeNull();
  });

  // agy holds this database open for the whole session, and the badge is read while it does.
  it("reads a database that is open elsewhere, without taking a write lock", async () => {
    writeDb([genRow({ used: 1234, window: 256_000, prompt: 10, output: 1 })]);
    const open = new DatabaseSync(antigravityDbPath(root, CONVERSATION));
    try {
      expect((await antigravityBadgesFromDb(root, CONVERSATION))?.context.contextTokens).toBe(1234);
      // Still writable by its owner afterwards: the read must not have left a lock behind.
      open.exec("insert into gen_metadata (idx, data, size) values (99, x'00', 1)");
    } finally {
      open.close();
    }
  });
});
