// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, mkdirSync, writeFileSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { projectSessionsDir } from "../../../server/session/project-dir.js";

// The timeline overlay read the whole transcript every time it was opened — a payload capped at 300
// events, paid for in hundreds of megabytes (#1386). It now folds once and resumes, so what matters
// is that the window still means the same thing: the NEWEST 300, and `truncated` counting every
// event the file ever had rather than the ones that survived the window.

let scratch: ScratchHome;
let n = 0;

const CWD = "/Users/me/proj";

async function freshTimeline() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/session-reads.js");
  return mod.sessionTimeline;
}

const toolUse = (name: string, ts: string) =>
  `${JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", name, input: {} }] } })}\n`;
const noise = () => `${JSON.stringify({ type: "user", message: { content: "hello" } })}\n`;

// projectSessionsDir, not a second copy of its rule: it resolves the cwd for the host platform and
// folds EVERY non-alphanumeric character to "-", so "/Users/me/proj" is `-Users-me-proj` on macOS
// and `D--Users-me-proj` on Windows. A spec that spelled the macOS answer wrote its transcript
// where the reader would never look (#1396).
function transcriptPath(id: string): string {
  const dir = projectSessionsDir(CWD);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.jsonl`);
}

function writeTranscript(body: string): string {
  const id = `sess-${++n}`;
  writeFileSync(transcriptPath(id), body);
  return id;
}

beforeEach(() => {
  scratch = takeScratchHome("mt-timeline-");
});
afterEach(() => scratch.release());

describe("sessionTimeline", () => {
  it("lists the tool uses in order, and says nothing was dropped", async () => {
    const sessionTimeline = await freshTimeline();
    const id = writeTranscript(toolUse("Read", "t1") + noise() + toolUse("Edit", "t2"));
    expect(await sessionTimeline(CWD, id)).toEqual({
      events: [
        { ts: "t1", tool: "Read", summary: "" },
        { ts: "t2", tool: "Edit", summary: "" },
      ],
      truncated: false,
    });
  });

  it("keeps the newest 300 and reports the rest as truncated", async () => {
    const sessionTimeline = await freshTimeline();
    const id = writeTranscript(Array.from({ length: 305 }, (_, i) => toolUse(`Tool${i}`, `t${i}`)).join(""));
    const timeline = await sessionTimeline(CWD, id);
    expect(timeline.events).toHaveLength(300);
    expect(timeline.events[0]).toMatchObject({ tool: "Tool5" });
    expect(timeline.events.at(-1)).toMatchObject({ tool: "Tool304" });
    expect(timeline.truncated).toBe(true);
  });

  // The window is a fold, so continuing one has to land where one uninterrupted pass would —
  // including which events fell out of the front of it.
  it("answers what one pass would after the transcript grows past the cap", async () => {
    const sessionTimeline = await freshTimeline();
    const id = writeTranscript(Array.from({ length: 290 }, (_, i) => toolUse(`Tool${i}`, `t${i}`)).join(""));
    await sessionTimeline(CWD, id);
    appendFileSync(transcriptPath(id), Array.from({ length: 20 }, (_, i) => toolUse(`Late${i}`, `l${i}`)).join(""));
    const resumed = await sessionTimeline(CWD, id);

    const oneShot = await (await freshTimeline())(CWD, id);
    expect(resumed).toEqual(oneShot);
    expect(resumed.events).toHaveLength(300);
    expect(resumed.events.at(-1)).toMatchObject({ tool: "Late19" });
    expect(resumed.truncated).toBe(true);
  });

  // Proven the same way as the session list: change the bytes while holding (size, mtime), and an
  // answer that still matches the ORIGINAL cannot have re-read the file.
  it("does not read an unchanged transcript twice", async () => {
    const sessionTimeline = await freshTimeline();
    const id = writeTranscript(toolUse("Read", "t1"));
    const file = transcriptPath(id);
    const frozen = new Date(1_700_000_000_000);
    utimesSync(file, frozen, frozen);
    expect((await sessionTimeline(CWD, id)).events).toEqual([{ ts: "t1", tool: "Read", summary: "" }]);

    const before = statSync(file);
    writeFileSync(file, toolUse("Edit", "t1")); // same length, different tool
    utimesSync(file, frozen, frozen);
    expect(statSync(file)).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });

    expect((await sessionTimeline(CWD, id)).events).toEqual([{ ts: "t1", tool: "Read", summary: "" }]);
  });

  it("has no events for a transcript that is not there", async () => {
    const sessionTimeline = await freshTimeline();
    expect(await sessionTimeline(CWD, "never-existed")).toEqual({ events: [], truncated: false });
  });
});
