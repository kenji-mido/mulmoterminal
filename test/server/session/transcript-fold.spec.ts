// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { isRecord } from "../../../common/isRecord.js";

// The machinery three readers share (title fields, cost, timeline): fold a transcript once, resume
// on what was appended, and keep the answer beside a big file (#1377 / #1386). What is pinned here
// is the part every caller depends on and none of them can see — that a resumed fold produces what
// one uninterrupted pass would, and that it does not reach back into the value already handed out.

let scratch: ScratchHome;
let home = "";
let projects = "";
let n = 0;

interface Counted {
  tools: string[];
  total: number;
}

const isCounted = (v: unknown): v is Counted =>
  isRecord(v) && typeof v.total === "number" && Array.isArray(v.tools) && v.tools.every((t) => typeof t === "string");

const COUNTED = {
  isValue: isCounted,
  empty: (): Counted => ({ tools: [], total: 0 }),
  fold: (into: Counted, record: Record<string, unknown>) => {
    if (typeof record.tool !== "string") return;
    into.total += 1;
    into.tools.push(record.tool);
  },
  copy: (v: Counted): Counted => ({ tools: [...v.tools], total: v.total }),
};

async function loadFold() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/transcript-fold.js");
  return mod.createTranscriptFold;
}

const toolLine = (tool: string) => `${JSON.stringify({ tool })}\n`;

function writeTranscript(body: string): string {
  const dir = path.join(projects, "-Users-me-proj");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `s-${++n}.jsonl`);
  writeFileSync(file, body);
  return file;
}

const stampOf = (file: string) => {
  const st = statSync(file);
  return { mtimeMs: st.mtimeMs, size: st.size };
};

beforeEach(() => {
  scratch = takeScratchHome("mt-fold-");
  home = scratch.path;
  projects = path.join(home, ".claude", "projects");
  mkdirSync(projects, { recursive: true });
});
afterEach(() => scratch.release());

describe("createTranscriptFold", () => {
  it("folds a transcript, and folds only the append the second time", async () => {
    const create = await loadFold();
    const fold = create<Counted>({ kind: "counted", version: 1, ...COUNTED });
    const file = writeTranscript(toolLine("Read") + toolLine("Edit"));
    expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["Read", "Edit"], total: 2 });

    appendFileSync(file, toolLine("Bash"));
    expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["Read", "Edit", "Bash"], total: 3 });
  });

  // The equivalence the whole design rests on: stopping and continuing must not change the answer.
  it("answers what one uninterrupted pass would", async () => {
    const create = await loadFold();
    const resumed = create<Counted>({ kind: "a", version: 1, ...COUNTED });
    const oneShot = create<Counted>({ kind: "b", version: 1, ...COUNTED });

    const file = writeTranscript(toolLine("Read"));
    await resumed.read(file, stampOf(file));
    appendFileSync(file, toolLine("Edit") + toolLine("Bash"));
    await resumed.read(file, stampOf(file));
    appendFileSync(file, toolLine("Write"));

    expect(await resumed.read(file, stampOf(file))).toEqual(await oneShot.read(file, stampOf(file)));
  });

  // `copy` exists for this: the resumed fold pushes into the accumulator, and the caller is still
  // holding the value it was given last time.
  it("does not mutate a value it has already handed out", async () => {
    const create = await loadFold();
    const fold = create<Counted>({ kind: "counted", version: 1, ...COUNTED });
    const file = writeTranscript(toolLine("Read"));
    const first = await fold.read(file, stampOf(file));

    appendFileSync(file, toolLine("Edit"));
    await fold.read(file, stampOf(file));

    expect(first).toEqual({ tools: ["Read"], total: 1 });
  });

  it("re-folds from the start when the transcript got shorter", async () => {
    const create = await loadFold();
    const fold = create<Counted>({ kind: "counted", version: 1, ...COUNTED });
    const file = writeTranscript(toolLine("Read") + toolLine("Edit"));
    await fold.read(file, stampOf(file));

    writeFileSync(file, toolLine("Bash"));
    expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["Bash"], total: 1 });
  });

  describe("the optional cheaper first read", () => {
    it("is used when it answers, and its offset is where the next fold resumes", async () => {
      const create = await loadFold();
      const file = writeTranscript(toolLine("Read") + toolLine("Edit"));
      const size = statSync(file).size;
      const fold = create<Counted>({
        kind: "counted",
        version: 1,
        ...COUNTED,
        cold: async () => ({ value: { tools: ["from-the-shortcut"], total: 1 }, offset: size }),
      });

      expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["from-the-shortcut"], total: 1 });
      appendFileSync(file, toolLine("Bash"));
      expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["from-the-shortcut", "Bash"], total: 2 });
    });

    // A shortcut that cannot answer exactly must cost nothing but the attempt — the whole file is
    // folded, rather than a half-answer being kept.
    it("falls back to the whole file when it answers null", async () => {
      const create = await loadFold();
      const fold = create<Counted>({ kind: "counted", version: 1, ...COUNTED, cold: async () => null });
      const file = writeTranscript(toolLine("Read") + toolLine("Edit"));
      expect(await fold.read(file, stampOf(file))).toEqual({ tools: ["Read", "Edit"], total: 2 });
    });
  });

  it("rejects for a transcript that is not there", async () => {
    const create = await loadFold();
    const fold = create<Counted>({ kind: "counted", version: 1, ...COUNTED });
    await expect(fold.read(path.join(projects, "gone.jsonl"), { mtimeMs: 1, size: 10 })).rejects.toThrow();
  });
});
