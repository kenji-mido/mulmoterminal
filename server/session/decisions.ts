// Reading past decisions back out of a Claude transcript (#997, step 1 of #991).
//
// Fed one record at a time rather than a whole file, for two reasons measured on real transcripts:
// this machine has a 585 MB one, which `readFileSync(..., "utf8")` cannot even represent
// (`ERR_STRING_TOO_LONG` above ~512 MB), and holding every tool result to look for an answer
// costs more memory than the answers are worth. A streaming fold keeps both bounded, and the
// records that matter are a rounding error in the file.
//
// The state it folds into is plain JSON, which is what lets the same fold be RESUMED from where a
// previous one stopped and kept beside the file (#1402) — a transcript only ever grows, so a scan
// that has to start over is paying for bytes it already read.
import type { DecisionAnswerKind, DecisionOption, DecisionQuestion, DecisionRecord } from "../../common/decisionLog.js";
import { isRecord } from "../../common/isRecord.js";
import { splitLines } from "../infra/split-lines.js";

const ASK_TOOL = "AskUserQuestion";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const optionsOf = (raw: unknown): DecisionOption[] =>
  Array.isArray(raw) ? raw.filter(isRecord).map((o) => ({ label: str(o.label), description: str(o.description) })) : [];

// A tool_result's text, whether the harness wrote it as a plain string or as content blocks.
const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((b) => str(b.text))
    .join("\n");
};

// Answers are unquoted prose inside quotes: the harness writes `"<question>"="<answer>"` pairs
// behind a lead-in ("The user answered:", "Your questions have been answered:") and escapes
// nothing, so an answer may contain `"` of its own — measured, 35 of 554 recorded result strings
// do, e.g. `"A: #app に translate="no"（推奨）"`. Stopping at the first quote truncated those, and a
// truncated answer stops matching its option label, which lands it in the free-text bucket this
// whole record exists to keep meaningful.
//
// So the end of an answer is found structurally wherever possible: another question's marker can
// only start after the previous answer closed, and those markers are exact (a question's own
// quotes are inside the marker, so they never confuse it). Only the LAST answer has no marker
// after it, and there the harness's own tail is the boundary.
// The harness's actual trailing text, matched as far as it is known: a bare `". ` also occurs
// INSIDE answers (`He said "yes". then continued` — Codex review), so a generic period test alone
// cuts a real answer short. These specific strings cannot appear by accident, so they are tried
// first; the generic pair below is the fallback for wording we have not seen, where a truncated
// answer still beats swallowing the harness's own sentence into it.
const HARNESS_TAILS = [". Read the answers carefully", ". You can now continue", " selected preview:"];
const GENERIC_TAILS = [". ", ".\n"];

const markerOf = (question: string): string => `"${question}"="`;

// The first quote at or after `from` that one of `tails` follows (or that ends the text), or -1.
function tailQuote(text: string, from: number, tails: string[]): number {
  for (let i = text.indexOf('"', from); i >= 0; i = text.indexOf('"', i + 1)) {
    const rest = text.slice(i + 1);
    if (rest === "" || tails.some((tail) => rest.startsWith(tail))) return i;
  }
  return -1;
}

// Where this answer ends: whichever comes FIRST of the next question's marker and the harness's
// own tail. Both are needed and neither alone is right — measured on real results. A preview block
// is written between an answer and the next question, so bounding only by the next marker swallows
// it; and a tail search alone runs past the next question, because the tail it finds belongs to
// the LAST answer in the string. If neither is found the shape is one we don't know, and the first
// quote is the floor: truncating loses characters, while over-capturing files unrelated text as
// something the user said.
function answerEnd(text: string, from: number, laterMarkers: number[]): number {
  const next = laterMarkers.filter((m) => m > from).sort((a, b) => a - b)[0];
  const known = tailQuote(text, from, HARNESS_TAILS);
  const bounds = [next, known >= 0 ? known : undefined].filter((n): n is number => n !== undefined);
  if (bounds.length > 0) return Math.min(...bounds);
  const generic = tailQuote(text, from, GENERIC_TAILS);
  if (generic >= 0) return generic;
  const firstQuote = text.indexOf('"', from);
  return firstQuote < 0 ? text.length : firstQuote;
}

// An answer that came from the offered options does not need delimiting at all: the labels are in
// the tool input, so the answer can be RECOGNISED instead of guessed at. That makes quotes,
// periods and preview blocks inside a label harmless, which is the whole class of edge case a
// delimiter rule keeps having (Codex review). Multi-select joins the chosen labels with ", ".
// Returns null when the text at `from` isn't a run of labels — i.e. the user wrote their own
// answer, which is exactly the case the delimiter rule below still has to handle.
function labelAnswer(text: string, from: number, options: DecisionOption[]): string | null {
  const labels = options
    .map((o) => o.label)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first, so a label that prefixes another can't win
  const chosen: string[] = [];
  let at = from;
  for (;;) {
    const label = labels.find((l) => text.startsWith(l, at));
    if (!label) return null;
    chosen.push(label);
    at += label.length;
    if (text.startsWith('"', at)) return chosen.join(", ");
    if (!text.startsWith(", ", at)) return null;
    at += ", ".length;
  }
}

/** `fromOptions` is carried out rather than re-derived from the text: a label may itself contain
 *  `, `, so re-splitting a recognised run of labels would fail to recognise it a second time. */
interface ParsedAnswer {
  answer: string | null;
  fromOptions: boolean;
}

function answerFor(question: string, text: string, start: number, laterMarkers: number[], options: DecisionOption[]): ParsedAnswer {
  if (start < 0) return { answer: null, fromOptions: false };
  const from = start + markerOf(question).length;
  const recognised = labelAnswer(text, from, options);
  if (recognised !== null) return { answer: recognised, fromOptions: true };
  const answer =
    text
      .slice(from, answerEnd(text, from, laterMarkers))
      .replace(/",\s*$/, "") // the `", ` that separates this pair from the next
      .trim() || null;
  return { answer, fromOptions: false };
}

// For an answer the label matcher did not recognise: it can still equal a label outright (a shape
// the matcher bails on, e.g. an unusual tail after it). Anything else is the user writing their
// own answer, which is the case worth being able to find later.
function classifyAnswer(parsed: ParsedAnswer, options: DecisionOption[]): DecisionAnswerKind {
  if (parsed.answer === null) return "unanswered";
  if (parsed.fromOptions) return "option";
  return options.some((o) => o.label === parsed.answer) ? "option" : "free-text";
}

// Each question's marker position, found in order and never re-finding an earlier one: two
// questions in the same call can carry identical text (a pair of "どれ？"s), and searching from the
// start for both would give them the same marker — so the second would inherit the first one's
// answer (Codex review). -1 for a question whose marker isn't there at all.
function markerPositions(questions: string[], text: string): number[] {
  const positions: number[] = [];
  let cursor = 0;
  for (const question of questions) {
    const at = text.indexOf(markerOf(question), cursor);
    positions.push(at);
    if (at >= 0) cursor = at + markerOf(question).length;
  }
  return positions;
}

function questionsOf(input: unknown, text: string | null): DecisionQuestion[] {
  const raw = (isRecord(input) && Array.isArray(input.questions) ? input.questions : []).filter(isRecord);
  const starts =
    text === null
      ? raw.map(() => -1)
      : markerPositions(
          raw.map((q) => str(q.question)),
          text,
        );
  return raw.map((q, i) => {
    const question = str(q.question);
    const options = optionsOf(q.options);
    const later = starts.slice(i + 1).filter((at) => at >= 0);
    const parsed = text === null ? { answer: null, fromOptions: false } : answerFor(question, text, starts[i] ?? 0, later, options);
    return {
      question,
      header: str(q.header),
      multiSelect: q.multiSelect === true,
      options,
      answer: parsed.answer,
      answerKind: classifyAnswer(parsed, options),
    };
  });
}

export interface Ask {
  toolUseId: string;
  ts: string;
  cwd: string | null;
  sessionId: string;
  input: unknown;
  resultText: string | null;
}

/** Everything the scan knows so far. Plain JSON on purpose: the same value is written beside a big
 *  transcript so the next process resumes instead of re-reading it (#1402), and a Map would not
 *  survive that trip. `pending` holds the ids of asks still waiting for their tool_result. */
export interface DecisionScanState {
  asks: Ask[];
  pending: string[];
}

export const emptyDecisionState = (): DecisionScanState => ({ asks: [], pending: [] });

/** A resumed fold mutates what it was handed (an answer is written onto the ask it belongs to), and
 *  the value it resumes from has already been given to a caller — so each ask is copied too. */
export const copyDecisionState = (state: DecisionScanState): DecisionScanState => ({
  asks: state.asks.map((ask) => ({ ...ask })),
  pending: [...state.pending],
});

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(line);
    return isRecord(o) ? o : null;
  } catch {
    return null;
  }
}

const contentBlocks = (o: Record<string, unknown>): Record<string, unknown>[] => {
  const content = isRecord(o.message) ? o.message.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
};

function collectAsks(state: DecisionScanState, o: Record<string, unknown>): void {
  if (o.type !== "assistant") return;
  for (const block of contentBlocks(o)) {
    if (block.type !== "tool_use" || block.name !== ASK_TOOL) continue;
    const ask: Ask = {
      toolUseId: str(block.id),
      ts: str(o.timestamp),
      cwd: str(o.cwd) || null,
      sessionId: str(o.sessionId),
      input: block.input,
      resultText: null,
    };
    state.asks.push(ask);
    // Each id at most once, as the Map this replaced held it: a second ask claiming an id already
    // waiting does not earn that id a second answer.
    if (ask.toolUseId && !state.pending.includes(ask.toolUseId)) state.pending.push(ask.toolUseId);
  }
}

function collectAnswer(state: DecisionScanState, o: Record<string, unknown>): void {
  for (const block of contentBlocks(o)) {
    if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    const at = state.pending.indexOf(block.tool_use_id);
    if (at < 0) continue;
    // findLast, not find: an id repeated in one transcript answers to the LAST ask that claimed it,
    // which is what the Map this replaced held.
    const ask = state.asks.findLast((a) => a.toolUseId === block.tool_use_id);
    if (!ask) continue;
    ask.resultText = resultText(block.content);
    state.pending.splice(at, 1);
  }
}

/** One record into the scan, in file order. Answers first: a tool_result can only belong to an ask
 *  from an EARLIER record, and running it first is what keeps that true within a record too. */
export function foldDecision(state: DecisionScanState, record: Record<string, unknown>): void {
  collectAnswer(state, record);
  collectAsks(state, record);
}

/** The decisions the state holds, oldest first. `fallbackSessionId` covers a record that names none. */
export function decisionsOf(state: DecisionScanState, fallbackSessionId: string): DecisionRecord[] {
  return state.asks
    .map((a) => ({
      sessionId: a.sessionId || fallbackSessionId,
      cwd: a.cwd,
      ts: a.ts,
      toolUseId: a.toolUseId,
      questions: questionsOf(a.input, a.resultText),
    }))
    .filter((d) => d.questions.length > 0);
}

/** Whole-string convenience for callers that already hold the text (and for tests). A file is folded
 *  record by record instead — see decision-scan.ts — through the same `foldDecision`. */
export function decisionsFromJsonl(raw: string, fallbackSessionId: string): DecisionRecord[] {
  const state = emptyDecisionState();
  for (const line of splitLines(raw)) {
    const record = parseLine(line);
    if (record) foldDecision(state, record);
  }
  return decisionsOf(state, fallbackSessionId);
}

/** Newest first. A record with no timestamp sorts last rather than jumping to the top. */
export const byNewest = (a: DecisionRecord, b: DecisionRecord): number => (b.ts || "").localeCompare(a.ts || "");
