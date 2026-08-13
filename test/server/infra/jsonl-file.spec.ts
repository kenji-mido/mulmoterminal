// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendFileSync, statSync } from "node:fs";
import { forEachJsonlLine, forEachJsonlRecord, forEachJsonlRecordIn, readTailLines, readTailRecords } from "../../../server/infra/jsonl-file.js";

// These two exist because `fs.readFile(file, "utf8")` throws past ~512 MB whatever the file holds,
// which silently emptied the longest sessions (#998). What matters in a spec is therefore the
// boundary handling — a reader that starts mid-file, and one that never holds the whole thing.

let dir = "";
const write = (name: string, body: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
};

beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "mt-jsonl-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("forEachJsonlLine", () => {
  it("delivers every line in order", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("a.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("delivers a final line that has no trailing newline", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("b.jsonl", '{"n":1}\n{"n":2}'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("reads an empty file as no lines", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("empty.jsonl", ""), (l) => seen.push(l));
    expect(seen).toEqual([]);
  });

  // A transcript's own content must never be mistaken for a line break — a tool_result carrying
  // \r\n is ordinary here, and readline's crlfDelay is what keeps it from splitting one line in two.
  it("does not split a CRLF pair into an empty line", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("crlf.jsonl", '{"n":1}\r\n{"n":2}\r\n'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("rejects rather than swallowing a file that isn't there", async () => {
    await expect(forEachJsonlLine(path.join(dir, "missing.jsonl"), () => {})).rejects.toThrow();
  });

  // The reason this is a callback and not "return the lines": the caller keeps a few fields out of
  // hundreds of megabytes, so nothing has to hold them all.
  it("lets the caller keep only what it wants", async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `{"i":${i}}`).join("\n");
    let last = "";
    let count = 0;
    await forEachJsonlLine(write("many.jsonl", body), (l) => {
      count += 1;
      last = l;
    });
    expect(count).toBe(5000);
    expect(last).toBe('{"i":4999}');
  });
});

describe("readTailLines", () => {
  it("returns every line when the file is smaller than the window", () => {
    expect(readTailLines(write("small.jsonl", "one\ntwo\nthree\n"))).toEqual(["one", "two", "three", ""]);
  });

  // The load-bearing case: starting mid-file lands inside a line, and half a line is not JSON.
  it("drops the first line when the read started mid-file", () => {
    const file = write("big.jsonl", `${"x".repeat(100)}\nkept-1\nkept-2\n`);
    expect(readTailLines(file, 20)).toEqual(["kept-1", "kept-2", ""]);
  });

  it("keeps the first line when the whole file fits, so nothing is lost", () => {
    const file = write("fits.jsonl", "first\nsecond\n");
    expect(readTailLines(file, 1024)[0]).toBe("first");
  });

  it("reads only the window, not the file", () => {
    // 2 MB of lines, a 1 KB window: what comes back is bounded by the window.
    const body = Array.from({ length: 40000 }, (_, i) => `line-${i}`).join("\n");
    const file = write("wide.jsonl", `${body}\n`);
    const tail = readTailLines(file, 1024);
    expect(tail.length).toBeLessThan(200);
    expect(tail.at(-2)).toBe("line-39999");
  });

  it.each([
    ["an empty file", ""],
    ["a file of only a newline", "\n"],
  ])("survives %s", (_case, body) => {
    expect(() => readTailLines(write("edge.jsonl", body))).not.toThrow();
  });

  // Every caller wants "no recent turn" rather than an exception — a session whose file was just
  // rotated away must not take the roster down with it.
  it("returns no lines for a file that isn't there", () => {
    expect(readTailLines(path.join(dir, "missing.jsonl"))).toEqual([]);
  });
});

describe("readTailRecords", () => {
  it("parses the records at the end", () => {
    const file = write("recs.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  // The partial first line a mid-file read leaves behind is not JSON, and neither is a corrupt
  // one. Both are skipped rather than taking the whole read down.
  it("skips a line that will not parse", () => {
    const file = write("partial.jsonl", '{"n":1}\nnot json\n{"n":2}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("skips a JSON line that is not an object", () => {
    const file = write("scalar.jsonl", '{"n":1}\n42\n"text"\n[1,2]\n{"n":2}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("has no records for an empty or missing file", () => {
    expect(readTailRecords(write("none.jsonl", ""))).toEqual([]);
    expect(readTailRecords(path.join(dir, "gone.jsonl"))).toEqual([]);
  });

  // The window has to hold a whole TURN, and one Claude record can carry an entire tool_result.
  // On the 585 MB transcript here the last 256 KB was nine records — not one complete turn — which
  // is why the default is 4 MB and not the codex rollout's 256 KB (#998).
  it("reads far enough back to cover records that are individually huge", () => {
    const fat = (i: number) => JSON.stringify({ i, blob: "x".repeat(200 * 1024) });
    const file = write("fat.jsonl", `${[0, 1, 2, 3, 4, 5].map(fat).join("\n")}\n`);
    const recs = readTailRecords(file);
    // At 256 KB only the last record would survive; the default window keeps several.
    expect(recs.length).toBeGreaterThan(1);
    expect(recs.at(-1)).toMatchObject({ i: 5 });
  });
});

// The reader the session list resumes with (#1377). What matters here is that a scan which stops
// and continues folds exactly what one uninterrupted scan would — a cheaper reader that answers
// something slightly different is the failure mode #998 warned about.
describe("forEachJsonlRecordIn", () => {
  const foldAll = async (file: string, range: Parameters<typeof forEachJsonlRecordIn>[1] = {}) => {
    const seen: Record<string, unknown>[] = [];
    const offset = await forEachJsonlRecordIn(file, range, (r) => seen.push(r));
    return { seen, offset };
  };

  it("folds the whole file from 0, exactly as the unbounded reader does", async () => {
    const file = write("all.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n');
    const whole: Record<string, unknown>[] = [];
    await forEachJsonlRecord(file, (r) => whole.push(r));
    const { seen, offset } = await foldAll(file);
    expect(seen).toEqual(whole);
    expect(offset).toBe(statSync(file).size);
  });

  // The equivalence the resume rests on: fold, append, continue — same answer as folding the grown
  // file in one pass. Without this the two paths are free to drift, which is how a window ends up
  // paraphrasing the rule it replaced.
  it("resuming after an append equals folding the grown file in one pass", async () => {
    const file = write("grow.jsonl", '{"n":1}\n{"n":2}\n');
    const first = await foldAll(file);
    appendFileSync(file, '{"n":3}\n{"n":4}\n');
    const resumed = await foldAll(file, { from: first.offset, atLineStart: true });
    const onePass = await foldAll(file);
    expect([...first.seen, ...resumed.seen]).toEqual(onePass.seen);
    expect(resumed.offset).toBe(onePass.offset);
  });

  // A writer caught mid-append leaves half a record. Folding it would be parsing broken JSON, and
  // counting it would move the resume point past a record that was never read.
  it("leaves a trailing HALF record for the next scan", async () => {
    const file = write("partial.jsonl", '{"n":1}\n{"n":2'); // truncated mid-record
    const { seen, offset } = await foldAll(file);
    expect(seen).toEqual([{ n: 1 }]);
    expect(offset).toBe('{"n":1}\n'.length);

    appendFileSync(file, "}\n");
    const rest = await foldAll(file, { from: offset, atLineStart: true });
    expect(rest.seen).toEqual([{ n: 2 }]);
  });

  // The other thing a newline-less last line can be: a record whose writer simply did not end the
  // file with one. The unbounded reader yields it, so this one must too — and it must count, or an
  // unchanged file would keep answering without its last record for as long as it is cached
  // (CodeRabbit on #1379).
  it("folds a valid final record that has no trailing newline, like the unbounded reader", async () => {
    const file = write("nonl.jsonl", '{"n":1}\n{"n":2}');
    const whole: Record<string, unknown>[] = [];
    await forEachJsonlRecord(file, (r) => whole.push(r));
    const { seen, offset } = await foldAll(file);
    expect(seen).toEqual(whole);
    expect(offset).toBe(statSync(file).size);
  });

  // A `to` cut is arbitrary — its last line is a fragment of the file, not a record the writer
  // finished — so the same "does it parse?" question must not be asked there.
  it("never folds the last line of a window that stops short of EOF", async () => {
    const file = write("cut.jsonl", '{"n":1}\n{"n":2}\n');
    const { seen, offset } = await foldAll(file, { to: 15 }); // ends right before the second newline
    expect(seen).toEqual([{ n: 1 }]);
    expect(offset).toBe(8);
  });

  // The difference between an offset a previous scan reported and one picked by arithmetic.
  it("drops a leading partial line for a window that starts mid-line, keeps it at a line start", async () => {
    const file = write("mid.jsonl", '{"n":1}\n{"n":2}\n');
    const midLine = 3; // inside the first record
    expect((await foldAll(file, { from: midLine })).seen).toEqual([{ n: 2 }]);
    expect((await foldAll(file, { from: 8, atLineStart: true })).seen).toEqual([{ n: 2 }]);
  });

  it("stops at `to`, without folding the record that straddles it", async () => {
    const file = write("to.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n');
    const { seen, offset } = await foldAll(file, { to: 12 });
    expect(seen).toEqual([{ n: 1 }]);
    expect(offset).toBe(8);
  });

  // A tool_result carrying \r\n must not split a record, and the byte count must still be the
  // file's own — a character count would drift and move the resume point.
  it("counts CRLF and multi-byte characters in bytes", async () => {
    const body = '{"a":"x"}\r\n{"b":"日本語"}\n';
    const file = write("crlf.jsonl", body);
    const { seen, offset } = await foldAll(file);
    expect(seen).toEqual([{ a: "x" }, { b: "日本語" }]);
    expect(offset).toBe(Buffer.byteLength(body));
  });

  it("folds nothing from an empty file or an empty range", async () => {
    const file = write("empty.jsonl", "");
    expect(await foldAll(file)).toEqual({ seen: [], offset: 0 });
    const two = write("two.jsonl", '{"n":1}\n');
    expect(await foldAll(two, { from: 8, to: 8 })).toEqual({ seen: [], offset: 8 });
  });

  it("rejects for a file that isn't there, like the streaming reader", async () => {
    await expect(foldAll(path.join(dir, "gone.jsonl"))).rejects.toThrow();
  });
});
