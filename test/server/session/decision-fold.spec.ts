// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  copyDecisionState,
  decisionsFromJsonl,
  decisionsOf,
  emptyDecisionState,
  foldDecision,
  type DecisionScanState,
} from "../../../server/session/decisions.js";

// The scan used to keep its state in a Map and be fed raw lines, which is why it could not be paused
// and continued the way the session list, summary, timeline and cost folds are (#1402). What has to
// hold now is that continuing it lands exactly where one uninterrupted pass would — the answers
// themselves are pinned by decisions.spec.ts, which this change left untouched.

const SESSION = "sess-1";

const ask = (id: string, question: string, over: Record<string, unknown> = {}) => ({
  type: "assistant",
  timestamp: "2026-08-04T00:00:00.000Z",
  cwd: "/Users/me/proj",
  sessionId: SESSION,
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
  ...over,
});

const answer = (id: string, question: string, text: string) => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: `Your questions have been answered: "${question}"="${text}". You can now continue` }],
  },
});

const chatter = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

const transcript: Record<string, unknown>[] = [
  chatter("thinking"),
  ask("t1", "ship it?"),
  chatter("waiting"),
  answer("t1", "ship it?", "yes"),
  chatter("working"),
  ask("t2", "release now?"),
  answer("t2", "release now?", "not yet"),
  ask("t3", "unanswered?"),
];

const foldAll = (records: Record<string, unknown>[]): DecisionScanState => {
  const state = emptyDecisionState();
  records.forEach((r) => foldDecision(state, r));
  return state;
};

const resumeFrom = (state: DecisionScanState, records: Record<string, unknown>[]): DecisionScanState => {
  const next = copyDecisionState(state);
  records.forEach((r) => foldDecision(next, r));
  return next;
};

describe("a decision scan folded in two goes", () => {
  it("equals one uninterrupted pass, wherever it is cut", () => {
    const whole = decisionsOf(foldAll(transcript), SESSION);
    for (let cut = 0; cut <= transcript.length; cut++) {
      const resumed = decisionsOf(resumeFrom(foldAll(transcript.slice(0, cut)), transcript.slice(cut)), SESSION);
      expect(resumed, `cut after ${cut} records`).toEqual(whole);
    }
  });

  // The cut that matters most: an answer resumed into a state whose question came from the previous
  // pass. That is the one an in-memory-only scan never had to survive.
  it("attaches an answer to a question folded before the pause", () => {
    const resumed = resumeFrom(foldAll(transcript.slice(0, 3)), transcript.slice(3));
    expect(decisionsOf(resumed, SESSION)[0]?.questions[0]?.answer).toBe("yes");
  });

  // The reason `copy` exists: a resumed fold writes the answer ONTO the ask object, and the state it
  // continued from has already been handed to a caller.
  it("leaves the state it continued from untouched", () => {
    const first = foldAll(transcript.slice(0, 3));
    const before = decisionsOf(first, SESSION);
    resumeFrom(first, transcript.slice(3));
    expect(decisionsOf(first, SESSION)).toEqual(before);
  });

  // A resumed fold has to survive the round trip through a sidecar, which is JSON.
  it("survives being written down and read back", () => {
    const half: unknown = JSON.parse(JSON.stringify(foldAll(transcript.slice(0, 3))));
    if (!isDecisionStateShape(half)) throw new Error("a folded decision scan should round-trip through JSON");
    expect(decisionsOf(resumeFrom(half, transcript.slice(3)), SESSION)).toEqual(decisionsOf(foldAll(transcript), SESSION));
  });

  // `pending` stands in for a Map keyed by tool_use_id, and the two only agree if an id is
  // remembered once and forgotten when it is answered. No real transcript repeats an id — this pins
  // the state against drifting from what it replaced, not a case anyone will see.
  it("gives a repeated tool-use id exactly one answer", () => {
    const state = foldAll([ask("dup", "first?"), ask("dup", "second?"), answer("dup", "second?", "yes"), answer("dup", "second?", "no")]);
    expect(state.pending).toEqual([]);
    expect(decisionsOf(state, SESSION).map((d) => d.questions[0]?.answer)).toEqual([null, "yes"]);
  });

  // The whole-string helper and the record fold are the same rule, so they cannot answer differently.
  it("agrees with decisionsFromJsonl on the same records", () => {
    const raw = transcript.map((r) => JSON.stringify(r)).join("\n");
    expect(decisionsFromJsonl(raw, SESSION)).toEqual(decisionsOf(foldAll(transcript), SESSION));
  });
});

// The same shape check decision-scan.ts applies to a sidecar, kept here so the round-trip test above
// fails loudly rather than casting its way past a state JSON could not carry.
function isDecisionStateShape(value: unknown): value is DecisionScanState {
  if (typeof value !== "object" || value === null) return false;
  const state: Partial<DecisionScanState> = value;
  return Array.isArray(state.asks) && Array.isArray(state.pending);
}
