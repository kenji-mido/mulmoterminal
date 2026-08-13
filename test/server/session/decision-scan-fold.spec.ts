// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { projectSessionsDir } from "../../../server/session/project-dir.js";

// The decision scan was the last transcript reader on a plain (mtime, size) memo, which can only
// skip an UNCHANGED file — and the session being written to never is one. The project's largest
// transcript was therefore re-read in full every time the digest tick or the skill asked (#1402).
// These pin what changed: the scan is continued rather than restarted, and a big one is kept beside
// the file so the next process continues it too.

let scratch: ScratchHome;
let home = "";
let n = 0;

const CWD = "/Users/me/proj";
const DECISION_LIMIT = 50;

async function freshDecisions() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/decision-scan.js");
  return mod.decisionsForCwd;
}

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

const ask = (id: string, question: string) =>
  line({
    type: "assistant",
    timestamp: `2026-08-04T00:00:0${id.length}.000Z`,
    cwd: CWD,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "AskUserQuestion",
          input: { questions: [{ question, header: "H", multiSelect: false, options: [{ label: "yes", description: "d" }] }] },
        },
      ],
    },
  });

const answer = (id: string, question: string, text: string) =>
  line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: `Your questions have been answered: "${question}"="${text}". You can now continue` }],
    },
  });

const filler = (bytes: number) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(bytes) }] } });

const OVER_THRESHOLD_BYTES = 11 * 1024 * 1024;

// projectSessionsDir, not a second copy of its rule: it folds every non-alphanumeric character to
// "-", so the same cwd names a different directory on Windows (#1396).
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

const decisionSidecars = (): string[] => {
  const root = path.join(home, ".mulmoterminal", "transcript-index", "decisions");
  return existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map(String)
        .filter((e) => e.endsWith(".json"))
    : [];
};

const answersOf = (found: { decisions: { questions: { answer: string | null }[] }[] }): (string | null)[] =>
  found.decisions.flatMap((d) => d.questions.map((q) => q.answer));

beforeEach(() => {
  scratch = takeScratchHome("mt-decisions-");
  home = scratch.path;
});
afterEach(() => scratch.release());

describe("decisionsForCwd", () => {
  it("reports a question and the answer it was given", async () => {
    const decisionsForCwd = await freshDecisions();
    writeTranscript(ask("t1", "ship it?") + answer("t1", "ship it?", "yes"));
    const found = await decisionsForCwd(CWD, DECISION_LIMIT);
    expect(found.scanned).toBe(1);
    expect(found.decisions).toHaveLength(1);
    expect(answersOf(found)).toEqual(["yes"]);
  });

  // The case the old memo could not help with: the file changed, so it re-read all of it. Now only
  // the append is folded — and the answer has to be the one a full read would give, including when
  // the answer arrives for a question folded during the PREVIOUS pass.
  it("continues the scan across a turn, landing where one pass would", async () => {
    const decisionsForCwd = await freshDecisions();
    const id = writeTranscript(ask("t1", "ship it?"));
    expect(answersOf(await decisionsForCwd(CWD, DECISION_LIMIT))).toEqual([null]);

    appendFileSync(transcriptPath(id), answer("t1", "ship it?", "yes") + ask("t2", "release now?") + answer("t2", "release now?", "not yet"));
    const resumed = await decisionsForCwd(CWD, DECISION_LIMIT);

    const oneShot = await (await freshDecisions())(CWD, DECISION_LIMIT);
    expect(resumed).toEqual(oneShot);
    expect(answersOf(resumed).sort()).toEqual(["not yet", "yes"]);
  });

  // The claim the whole change rests on, and the one an equal-answers test cannot make: a GROWN
  // transcript costs only the bytes that arrived. Proven by rewriting the already-scanned prefix to
  // a same-length lie before appending — a scan that started over would report the lie.
  it("folds only the bytes that arrived", async () => {
    const decisionsForCwd = await freshDecisions();
    const id = writeTranscript(ask("t1", "ship it?"));
    const file = transcriptPath(id);
    expect(await decisionsForCwd(CWD, DECISION_LIMIT)).toMatchObject({ decisions: [{ questions: [{ question: "ship it?" }] }] });

    const rewritten = ask("t1", "REWROTE!"); // same length as the question it replaces
    expect(rewritten).toHaveLength(ask("t1", "ship it?").length);
    writeFileSync(file, rewritten);
    appendFileSync(file, answer("t1", "ship it?", "yes"));

    const resumed = await decisionsForCwd(CWD, DECISION_LIMIT);
    expect(resumed.decisions[0]?.questions[0]?.question).toBe("ship it?");
    expect(answersOf(resumed)).toEqual(["yes"]);
  });

  // Proven by changing the bytes under a held (size, mtime): an answer that still matches the
  // ORIGINAL cannot have re-read the transcript.
  it("does not read an unchanged transcript twice", async () => {
    const decisionsForCwd = await freshDecisions();
    const id = writeTranscript(ask("t1", "ship it?") + answer("t1", "ship it?", "yes"));
    const file = transcriptPath(id);
    const frozen = new Date(1_700_000_000_000);
    utimesSync(file, frozen, frozen);
    expect(answersOf(await decisionsForCwd(CWD, DECISION_LIMIT))).toEqual(["yes"]);

    const before = statSync(file);
    writeFileSync(file, ask("t1", "ship it?") + answer("t1", "ship it?", "no!")); // same length
    utimesSync(file, frozen, frozen);
    expect(statSync(file)).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });

    expect(answersOf(await decisionsForCwd(CWD, DECISION_LIMIT))).toEqual(["yes"]);
  });

  // A big session is where the seconds went, so that is the one worth keeping on disk — and a second
  // process (a restart, the next mulmoterminal, the digest tick) has to continue from it.
  it("keeps a big session's scan beside it, and resumes from that in a fresh process", async () => {
    const decisionsForCwd = await freshDecisions();
    const id = writeTranscript(ask("t1", "ship it?") + filler(OVER_THRESHOLD_BYTES));
    expect(answersOf(await decisionsForCwd(CWD, DECISION_LIMIT))).toEqual([null]);
    await settled();
    expect(decisionSidecars()).toHaveLength(1);

    appendFileSync(transcriptPath(id), answer("t1", "ship it?", "yes"));
    const inAnotherProcess = await (await freshDecisions())(CWD, DECISION_LIMIT);
    expect(answersOf(inAnotherProcess)).toEqual(["yes"]);
  });

  it("reports nothing for a project with no transcripts", async () => {
    const decisionsForCwd = await freshDecisions();
    const found = await decisionsForCwd(CWD, DECISION_LIMIT);
    expect(found).toEqual({ decisions: [], scanned: 0, unreadable: 0 });
  });
});
