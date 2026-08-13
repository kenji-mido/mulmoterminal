// @vitest-environment node
import { describe, it, expect } from "vitest";
import { byNewest, decisionsFromJsonl } from "../../../server/session/decisions";

// The fixtures below are the shapes actually found in ~/.claude/projects on 2026-07-28 — both
// tool_result lead-ins, a free-text answer, a `selected preview:` tail, and a question that was
// never answered. Invented shapes would test the parser against a transcript nobody writes.

const askLine = (opts: { id: string; ts?: string; questions: unknown[] }) =>
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/isamu/ss/llm/mulmoterminal4",
    sessionId: "sesn-1",
    timestamp: opts.ts ?? "2026-07-27T08:41:43.600Z",
    message: { content: [{ type: "tool_use", id: opts.id, name: "AskUserQuestion", input: { questions: opts.questions } }] },
  });

const resultLine = (id: string, text: string) =>
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

const GO_NOW = { label: "今から実装する（推奨）", description: "origin/main から feature ブランチを切り…" };
const WAIT = { label: "報告者の 2.2.0 実機確認を待つ", description: "keymap 側の確認結果が出てから着手" };
const QUESTION = { question: "copyOnSelect の実装を今から進めますか？", header: "進め方", multiSelect: false, options: [GO_NOW, WAIT] };

describe("decisionsFromJsonl", () => {
  it("reads the question, its options with their descriptions, and the chosen answer", () => {
    const raw = [
      askLine({ id: "toolu_1", questions: [QUESTION] }),
      resultLine("toolu_1", `The user answered: "${QUESTION.question}"="${GO_NOW.label}". Read the answers carefully — they may request clarification.`),
    ].join("\n");

    expect(decisionsFromJsonl(raw, "fallback")).toEqual([
      {
        sessionId: "sesn-1",
        cwd: "/Users/isamu/ss/llm/mulmoterminal4",
        ts: "2026-07-27T08:41:43.600Z",
        toolUseId: "toolu_1",
        questions: [
          {
            question: QUESTION.question,
            header: "進め方",
            multiSelect: false,
            options: [GO_NOW, WAIT],
            answer: GO_NOW.label,
            answerKind: "option",
          },
        ],
      },
    ]);
  });

  it("reads the other lead-in the harness uses", () => {
    const raw = [
      askLine({ id: "toolu_2", questions: [QUESTION] }),
      resultLine("toolu_2", `Your questions have been answered: "${QUESTION.question}"="${WAIT.label}". You can now continue with these answers in mind.`),
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answer).toBe(WAIT.label);
  });

  it("marks an answer the user wrote themselves as free-text — the options were wrong, not the choice", () => {
    // Real: the user answered a "how should we handle http://" question with "what even is
    // copyOnSelect?". Recording that as just another answer would lose the only interesting part.
    const raw = [
      askLine({ id: "toolu_3", questions: [QUESTION] }),
      resultLine("toolu_3", `The user answered: "${QUESTION.question}"="copyOnSelectってなに？windows固有の機能？". Read the answers carefully.`),
    ].join("\n");
    const [q] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(q.answer).toBe("copyOnSelectってなに？windows固有の機能？");
    expect(q.answerKind).toBe("free-text");
  });

  it("stops at the closing quote when the harness appends a preview block after it", () => {
    const raw = [
      askLine({ id: "toolu_4", questions: [QUESTION] }),
      resultLine("toolu_4", `The user answered: "${QUESTION.question}"="${GO_NOW.label}" selected preview:\n正常時:  Opus · ctx 58%. Continue.`),
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answer).toBe(GO_NOW.label);
  });

  it("pairs each question in a multi-question call with its own answer", () => {
    const second = { question: "何がまだ決まっていませんか？", header: "論点", multiSelect: true, options: [{ label: "設計方針", description: "d" }] };
    const raw = [
      askLine({ id: "toolu_5", questions: [QUESTION, second] }),
      resultLine(
        "toolu_5",
        `Your questions have been answered: "${QUESTION.question}"="${WAIT.label}", "${second.question}"="設計方針". You can now continue.`,
      ),
    ].join("\n");
    const [a, b] = decisionsFromJsonl(raw, "f")[0].questions;
    expect([a.answer, a.answerKind]).toEqual([WAIT.label, "option"]);
    expect([b.answer, b.answerKind, b.multiSelect]).toEqual(["設計方針", "option", true]);
  });

  it("counts every chosen label of a multi-select answer as chosen-from-options", () => {
    const q = {
      question: "どれ？",
      header: "h",
      multiSelect: true,
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
      ],
    };
    const raw = [askLine({ id: "toolu_6", questions: [q] }), resultLine("toolu_6", `The user answered: "どれ？"="A, B". Continue.`)].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answerKind).toBe("option");
  });

  it('keeps an answer that contains quotes of its own (real: `translate="no"`)', () => {
    // 35 of the 554 recorded result strings carry quotes beyond the pair structure, and nothing
    // escapes them. Truncating at the first one stopped the answer matching its option label,
    // which silently moved a chosen option into the free-text bucket (Codex review).
    const q = {
      question: "修正方針はどれにしますか？",
      header: "方針",
      multiSelect: false,
      options: [{ label: 'A: #app に translate="no"（推奨）', description: "d" }],
    };
    const raw = [
      askLine({ id: "toolu_11", questions: [q] }),
      resultLine(
        "toolu_11",
        `Your questions have been answered: "修正方針はどれにしますか？"="A: #app に translate="no"（推奨）" selected preview:\nindex.html\n  <div id="app" translate="no"></div>`,
      ),
    ].join("\n");
    const [got] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(got.answer).toBe('A: #app に translate="no"（推奨）');
    expect(got.answerKind).toBe("option");
  });

  it("bounds a quoted answer by the next question rather than by its own quotes", () => {
    const q1 = { question: "どう出す？", header: "h1", multiSelect: false, options: [{ label: 'aria-label="x" を付ける', description: "" }] };
    const q2 = { question: "いつやる？", header: "h2", multiSelect: false, options: [{ label: "あとで", description: "" }] };
    const raw = [
      askLine({ id: "toolu_12", questions: [q1, q2] }),
      resultLine("toolu_12", `The user answered: "どう出す？"="aria-label="x" を付ける", "いつやる？"="あとで". Read the answers carefully.`),
    ].join("\n");
    const [a, b] = decisionsFromJsonl(raw, "f")[0].questions;
    expect([a.answer, a.answerKind]).toEqual(['aria-label="x" を付ける', "option"]);
    expect([b.answer, b.answerKind]).toEqual(["あとで", "option"]);
  });

  it("stops at the preview block that sits between one answer and the next question", () => {
    // The shape that broke a first attempt at this: with previews, the harness writes
    // `"Q1"="A1" selected preview:\n<diagram>, "Q2"="A2"`. Bounding an answer only by the next
    // question's marker swallowed the whole diagram into A1 — 39 real answers got longer and
    // stopped matching their option labels, which is worse than truncating them.
    const q1 = { question: "どう扱いますか？", header: "h1", multiSelect: false, options: [{ label: "入力欄に戻して手動送信", description: "" }] };
    const q2 = { question: "いつやる？", header: "h2", multiSelect: false, options: [{ label: "あとで", description: "" }] };
    const raw = [
      askLine({ id: "toolu_14", questions: [q1, q2] }),
      resultLine(
        "toolu_14",
        `The user answered: "どう扱いますか？"="入力欄に戻して手動送信" selected preview:\n[buffer]\n └ メッセージ2, "いつやる？"="あとで". Continue.`,
      ),
    ].join("\n");
    const [a, b] = decisionsFromJsonl(raw, "f")[0].questions;
    expect([a.answer, a.answerKind]).toEqual(["入力欄に戻して手動送信", "option"]);
    expect([b.answer, b.answerKind]).toEqual(["あとで", "option"]);
  });

  it('recognises a chosen option that itself contains `". ` — no delimiter guess can', () => {
    // Codex's reproducer: a quote-period-space INSIDE the answer looks exactly like the harness's
    // own tail. It cannot be told apart by delimiters, so a chosen answer is matched against the
    // labels the question offered instead — those are in the tool input, and an exact match needs
    // no guess. (A user's own free-text answer containing `". ` is still cut there; nothing in the
    // string says where it ends, and truncating beats swallowing the harness's sentence.)
    const label = 'He said "hi". Then left';
    const q = { question: "どれ？", header: "h", multiSelect: false, options: [{ label, description: "" }] };
    const raw = [
      askLine({ id: "toolu_15", questions: [q] }),
      resultLine("toolu_15", `The user answered: "どれ？"="${label}". Read the answers carefully.`),
    ].join("\n");
    const [got] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(got.answer).toBe(label);
    expect(got.answerKind).toBe("option");
  });

  it("recognises multi-select labels that contain quotes and commas of their own", () => {
    const a = { label: 'A: translate="no", 全体', description: "" };
    const b = { label: "B: 個別", description: "" };
    const q = { question: "どれ？", header: "h", multiSelect: true, options: [a, b] };
    const raw = [askLine({ id: "toolu_16", questions: [q] }), resultLine("toolu_16", `The user answered: "どれ？"="${a.label}, ${b.label}". Continue.`)].join(
      "\n",
    );
    const [got] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(got.answer).toBe(`${a.label}, ${b.label}`);
    expect(got.answerKind).toBe("option");
  });

  it("does not mistake a free-text answer that merely starts with an option label", () => {
    const raw = [
      askLine({ id: "toolu_17", questions: [QUESTION] }),
      resultLine("toolu_17", `The user answered: "${QUESTION.question}"="${GO_NOW.label} でもその前に確認したい". Continue.`),
    ].join("\n");
    const [got] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(got.answer).toBe(`${GO_NOW.label} でもその前に確認したい`);
    expect(got.answerKind).toBe("free-text");
  });

  it("keeps a free-text answer whose own quoted phrase is followed by a period", () => {
    // Codex's reproducer, with the harness's real trailing sentence: a bare `". ` occurs inside
    // the answer, so the specific sentence is what marks the end. No label matching can help here
    // — the user wrote this answer rather than choosing one.
    const answer = 'He said "yes". then continued';
    const raw = [
      askLine({ id: "toolu_18", questions: [QUESTION] }),
      resultLine("toolu_18", `The user answered: "${QUESTION.question}"="${answer}". Read the answers carefully — they may request clarification.`),
    ].join("\n");
    const [got] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(got.answer).toBe(answer);
    expect(got.answerKind).toBe("free-text");
  });

  it("still ends a free-text answer sensibly when the harness's wording is one we have not seen", () => {
    // The fallback tier: an unknown trailing sentence, so the generic `". ` rule applies and the
    // answer is cut at its own quoted phrase. Pinned deliberately — losing characters is the
    // accepted failure here, and swallowing the harness's sentence into the answer is not.
    const raw = [
      askLine({ id: "toolu_19", questions: [QUESTION] }),
      resultLine("toolu_19", `The user answered: "${QUESTION.question}"="He said "yes". then continued". Some future sentence.`),
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answer).toBe('He said "yes');
  });

  it("gives two identically-worded questions their own answers", () => {
    // Both markers are the same string, so searching from the start for each one found the first
    // twice and the second question inherited the first's answer (Codex review).
    const q = (options: { label: string; description: string }[]) => ({ question: "どれ？", header: "h", multiSelect: false, options });
    const first = q([{ label: "A", description: "" }]);
    const second = q([{ label: "B", description: "" }]);
    const raw = [
      askLine({ id: "toolu_20", questions: [first, second] }),
      resultLine("toolu_20", `The user answered: "どれ？"="A", "どれ？"="B". Read the answers carefully.`),
    ].join("\n");
    const [a, b] = decisionsFromJsonl(raw, "f")[0].questions;
    expect([a.answer, a.answerKind]).toEqual(["A", "option"]);
    expect([b.answer, b.answerKind]).toEqual(["B", "option"]);
  });

  it("matches a question that itself contains quotes", () => {
    // Real: `"context-menu の "New file" をクリックした後、…"="表示されて…"`. The question's own quotes
    // are inside the marker, so an exact marker match is unaffected by them.
    const q = { question: 'context-menu の "New file" をクリックした後、入力フィールドは表示されましたか？', header: "確認", multiSelect: false, options: [] };
    const raw = [
      askLine({ id: "toolu_13", questions: [q] }),
      resultLine("toolu_13", `Your questions have been answered: "${q.question}"="表示されて文字も打てるが Enter で何も起きない". You can now continue.`),
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answer).toBe("表示されて文字も打てるが Enter で何も起きない");
  });

  it("still collects an answer whose own text mentions AskUserQuestion", () => {
    // The line-level prefilter that skips JSON.parse used to treat "this line contains
    // AskUserQuestion" as "this line is a question" and return early, so an answer that happened
    // to say the word was never collected and the question read as unanswered (Codex + CodeRabbit).
    const raw = [
      askLine({ id: "toolu_10", questions: [QUESTION] }),
      resultLine("toolu_10", `The user answered: "${QUESTION.question}"="AskUserQuestion って何？". Read the answers carefully.`),
    ].join("\n");
    const [q] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(q.answer).toBe("AskUserQuestion って何？");
    expect(q.answerKind).toBe("free-text");
  });

  it("keeps a question that was never answered, rather than dropping it", () => {
    // A session interrupted mid-question is itself a fact worth having: it was asked, and the
    // decision never happened.
    const raw = askLine({ id: "toolu_7", questions: [QUESTION] });
    const [q] = decisionsFromJsonl(raw, "f")[0].questions;
    expect(q.answer).toBeNull();
    expect(q.answerKind).toBe("unanswered");
  });

  it("falls back to the given session id when the line carries none", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_8", name: "AskUserQuestion", input: { questions: [QUESTION] } }] },
    });
    const [d] = decisionsFromJsonl(raw, "from-filename");
    expect([d.sessionId, d.cwd, d.ts]).toEqual(["from-filename", null, ""]);
  });

  it("ignores every other tool and every other line", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "ls" } }] } }),
      JSON.stringify({ type: "user", message: { content: "just a prompt" } }),
      "not json at all",
      "",
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")).toEqual([]);
  });

  it("survives a malformed AskUserQuestion input without throwing", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "AskUserQuestion", input: { questions: "nope" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "AskUserQuestion", input: {} }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "AskUserQuestion", input: { questions: [{}] } }] } }),
    ].join("\n");
    const found = decisionsFromJsonl(raw, "f");
    expect(found).toHaveLength(1); // only the one with a (blank) question survives
    expect(found[0].questions[0]).toEqual({ question: "", header: "", multiSelect: false, options: [], answer: null, answerKind: "unanswered" });
  });

  it("reads a tool_result written as content blocks, not just as a string", () => {
    const raw = [
      askLine({ id: "toolu_9", questions: [QUESTION] }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_9", content: [{ type: "text", text: `The user answered: "${QUESTION.question}"="${GO_NOW.label}".` }] },
          ],
        },
      }),
    ].join("\n");
    expect(decisionsFromJsonl(raw, "f")[0].questions[0].answer).toBe(GO_NOW.label);
  });
});

describe("byNewest", () => {
  const at = (ts: string): { ts: string } => ({ ts });

  it("orders newest first and sinks a record with no timestamp", () => {
    const sorted = [at(""), at("2026-07-27T08:00:00Z"), at("2026-07-28T09:00:00Z")]
      .map((r) => ({ ...r, sessionId: "s", cwd: null, toolUseId: "t", questions: [] }))
      .sort(byNewest)
      .map((r) => r.ts);
    expect(sorted).toEqual(["2026-07-28T09:00:00Z", "2026-07-27T08:00:00Z", ""]);
  });
});
