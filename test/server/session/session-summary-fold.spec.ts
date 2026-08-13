// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { projectSessionsDir } from "../../../server/session/project-dir.js";

// `/api/session/:id` is hit by every grid cell as its turn finishes, and a memo keyed on
// (mtime, size) could only skip an UNCHANGED transcript — which the session being written to never
// is. An active 508 MB session therefore paid a full 10.5 s read per turn (#1386). These pin what
// changed: the summary is folded once and continued, and a big one is kept beside the file.

let scratch: ScratchHome;
let home = "";
let n = 0;

const CWD = "/Users/me/proj";

async function freshSummary() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/session-reads.js");
  return mod.readSessionSummary;
}

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const user = (text: string) => line({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (text: string, over: Record<string, unknown> = {}) =>
  line({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
      ...over,
    },
  });
const toolUse = (name: string) =>
  line({ type: "assistant", message: { role: "assistant", model: "claude-opus-5", content: [{ type: "tool_use", name, input: {} }] } });
const filler = (bytes: number) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(bytes) }] } });

const OVER_THRESHOLD_BYTES = 11 * 1024 * 1024;

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

const settled = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5));
};

const summarySidecars = (): string[] => {
  const root = path.join(home, ".mulmoterminal", "transcript-index", "summary");
  return existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map(String)
        .filter((e) => e.endsWith(".json"))
    : [];
};

beforeEach(() => {
  scratch = takeScratchHome("mt-summary-");
  home = scratch.path;
});
afterEach(() => scratch.release());

describe("readSessionSummary", () => {
  it("reports the prompt, reply, turns, usage and phase of a session", async () => {
    const readSessionSummary = await freshSummary();
    const id = writeTranscript(user("build the parser") + toolUse("Edit") + assistant("done"));
    const summary = await readSessionSummary(CWD, id);
    expect(summary.lastPrompt).toBe("build the parser");
    expect(summary.lastResponse).toBe("done");
    expect(summary.userTurns).toBe(1);
    expect(summary.usage.outputTokens).toBe(5);
    expect(summary.context.model).toBe("claude-opus-5");
    expect(summary.workPhase).not.toBeNull();
  });

  // The case the old memo could not help with: the file changed, so it re-read all of it. Now the
  // append is all that is folded — and the answer has to be the one a full read would give.
  it("continues the fold across a turn, landing where one pass would", async () => {
    const readSessionSummary = await freshSummary();
    const id = writeTranscript(user("build the parser") + assistant("first reply"));
    await readSessionSummary(CWD, id);

    appendFileSync(transcriptPath(id), user("now the tests") + toolUse("Bash") + assistant("second reply"));
    const resumed = await readSessionSummary(CWD, id);

    const oneShot = await (await freshSummary())(CWD, id);
    expect(resumed).toEqual(oneShot);
    expect(resumed.lastPrompt).toBe("now the tests");
    expect(resumed.lastResponse).toBe("second reply");
    expect(resumed.userTurns).toBe(2);
  });

  // Proven by changing the bytes under a held (size, mtime): an answer that still matches the
  // ORIGINAL cannot have re-read the transcript.
  it("does not read an unchanged transcript twice", async () => {
    const readSessionSummary = await freshSummary();
    const id = writeTranscript(user("build the parser") + assistant("first reply"));
    const file = transcriptPath(id);
    const frozen = new Date(1_700_000_000_000);
    utimesSync(file, frozen, frozen);
    expect((await readSessionSummary(CWD, id)).lastResponse).toBe("first reply");

    const before = statSync(file);
    writeFileSync(file, user("build the parser") + assistant("SECOND repl")); // same length
    utimesSync(file, frozen, frozen);
    expect(statSync(file)).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });

    expect((await readSessionSummary(CWD, id)).lastResponse).toBe("first reply");
  });

  // A big session is where the 10.5 s went, so that is the one worth keeping on disk — and a second
  // process (a restart, the next mulmoterminal) has to be able to continue from it.
  it("keeps a big session's summary beside it, and resumes from that in a fresh process", async () => {
    const readSessionSummary = await freshSummary();
    const id = writeTranscript(user("build the parser") + filler(OVER_THRESHOLD_BYTES) + assistant("first reply"));
    expect((await readSessionSummary(CWD, id)).lastResponse).toBe("first reply");
    await settled();
    expect(summarySidecars()).toHaveLength(1);

    appendFileSync(transcriptPath(id), user("now the tests") + assistant("second reply"));
    const inAnotherProcess = await (await freshSummary())(CWD, id);
    expect(inAnotherProcess.lastPrompt).toBe("now the tests");
    expect(inAnotherProcess.lastResponse).toBe("second reply");
    expect(inAnotherProcess.userTurns).toBe(2);
  });

  it("is empty for a transcript that is not there", async () => {
    const readSessionSummary = await freshSummary();
    const summary = await readSessionSummary(CWD, "never-existed");
    expect(summary.lastPrompt).toBeNull();
    expect(summary.userTurns).toBe(0);
  });
});
