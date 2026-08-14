// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { agentBadges, type BadgeRoots } from "../../../server/session/agent-badges.js";

// The header badges for a session that is not Claude (#1465). Each agent is asked the question the
// same way and answers as much of it as its own log can, and all four now answer both badges bar
// agy's before its first generation. What must NOT happen is a number nobody wrote down, or a model
// another session was running.

const ROLLOUT_ID = "019fcb3a-a33c-7e72-8364-57e44926dfed";
const GROK_ID = "150496cf-fb8d-4c35-b19b-e2826a4e7242";
const AGY_ID = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
const CWD = "/Users/x/my proj";

const tokenCountLine = JSON.stringify({
  timestamp: "2026-08-04T05:26:35.526Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: 108_611, cached_input_tokens: 21_248, output_tokens: 6481, total_tokens: 115_092 },
      last_token_usage: { input_tokens: 55_447, cached_input_tokens: 16_768, output_tokens: 3215, total_tokens: 58_662 },
      model_context_window: 258_400,
    },
  },
});
const turnContextLine = JSON.stringify({ timestamp: "2026-08-04T05:24:19.315Z", type: "turn_context", payload: { turn_id: "t1", model: "gpt-5.5" } });

describe("agentBadges", () => {
  let home = "";
  // The roots are injected rather than pointed at by CODEX_HOME / GROK_HOME: those are read by
  // every other codex and grok reader in the process, and a spec that reassigns them owns the
  // environment of whatever else its worker runs.
  let roots: BadgeRoots = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "mt-agent-badges-"));
    roots = {
      codexSessions: path.join(home, "codex", "sessions"),
      grokSessions: path.join(home, "grok", "sessions"),
      antigravityHome: path.join(home, "antigravity"),
    };
  });

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const writeRollout = (lines: string[]) => {
    const dir = path.join(home, "codex", "sessions", "2026", "08", "04");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-2026-08-04T05-24-05-${ROLLOUT_ID}.jsonl`), `${lines.join("\n")}\n`);
  };

  const grokDir = () => {
    const dir = path.join(home, "grok", "sessions", encodeURIComponent(CWD), GROK_ID);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeGrokSummary = (summary: unknown) => fs.writeFileSync(path.join(grokDir(), "summary.json"), JSON.stringify(summary));
  const writeGrokSignals = (signals: unknown) => fs.writeFileSync(path.join(grokDir(), "signals.json"), JSON.stringify(signals));
  const writeGrokUpdates = (usages: Record<string, number>[]) =>
    fs.writeFileSync(
      path.join(grokDir(), "updates.jsonl"),
      `${usages.map((usage) => JSON.stringify({ method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed", usage } } })).join("\n")}\n`,
    );

  // agy's accounting store, in the nesting antigravity-usage.ts reads (its own spec covers the
  // shape; this one only has to prove the badge route reaches it).
  const writeAntigravityDb = (id: string, gen: { used: number; window: number; prompt: number; output: number; cached?: number }) => {
    const dir = path.join(home, "antigravity", "conversations");
    fs.mkdirSync(dir, { recursive: true });
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
    const v = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
    const msg = (field: number, body: number[]) => [...varint(field * 8 + 2), ...varint(body.length), ...body];
    const blob = Buffer.from(
      msg(1, [
        ...msg(4, [...v(2, gen.prompt), ...v(3, gen.output), ...(gen.cached === undefined ? [] : v(5, gen.cached))]),
        ...msg(9, [...msg(10, [...v(1, gen.used), ...v(4, gen.window)])]),
      ]),
    );
    const db = new DatabaseSync(path.join(dir, `${id}.db`));
    db.exec("create table gen_metadata (idx integer primary key, data blob, size integer not null default 0)");
    db.prepare("insert into gen_metadata (idx, data, size) values (0, $data, $size)").run({ data: blob, size: blob.length });
    db.close();
  };

  const writeAntigravityTranscript = (id: string, settings: string) => {
    const file = path.join(home, "antigravity", "brain", id, ".system_generated", "logs", "transcript.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = `<USER_REQUEST>\nhi\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\n${settings}\n</USER_SETTINGS_CHANGE>`;
    fs.writeFileSync(file, `${JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content })}\n`);
  };

  it("reads a codex session's totals, context and window out of its rollout", async () => {
    writeRollout([turnContextLine, tokenCountLine]);
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context).toEqual({ model: "gpt-5.5", contextTokens: 55_447, contextWindow: 258_400 });
    expect(badges.usage.inputTokens).toBe(108_611);
    expect(badges.usage.outputTokens).toBe(6481);
  });

  // The one field that is not cumulative: `turn_context` is written once, at the start of a turn,
  // so a turn bigger than the tail window leaves its model row outside it. Without the head
  // fallback the badge disappears on exactly the long sessions the bounded read is for.
  it("falls back to the head's model when a huge turn pushed turn_context out of the tail", async () => {
    const filler = JSON.stringify({ type: "response_item", payload: { junk: "x".repeat(200_000) } });
    writeRollout([turnContextLine, ...Array.from({ length: 30 }, () => filler), tokenCountLine]);
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context.model).toBe("gpt-5.5"); // read from the head, not the 4 MB tail
    expect(badges.context.contextTokens).toBe(55_447); // and the numbers still come from the tail
  });

  // Nothing on disk to read is the ordinary state of a session that has just been launched, and it
  // has to be silence rather than zeroes presented as a reading.
  it("answers nothing for a codex session with no rollout", async () => {
    const badges = await agentBadges(CWD, ROLLOUT_ID, "codex", roots);
    expect(badges.context.model).toBeNull();
    expect(badges.usage.inputTokens).toBe(0);
  });

  it("reads a grok session's totals, context and window across its three files", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5", session_summary: "whatever" });
    writeGrokSignals({ contextTokensUsed: 51_537, contextWindowTokens: 500_000, primaryModelId: "grok-4.5" });
    writeGrokUpdates([
      { inputTokens: 109_728, outputTokens: 1436, cachedReadTokens: 65_920 },
      { inputTokens: 98_548, outputTokens: 1388, cachedReadTokens: 92_160 },
    ]);
    const badges = await agentBadges(CWD, GROK_ID, "grok", roots);
    expect(badges.context).toEqual({ model: "grok-4.5", contextTokens: 51_537, contextWindow: 500_000 });
    expect(badges.usage.inputTokens + badges.usage.cacheReadTokens).toBe(109_728 + 98_548); // summed, per turn
    expect(badges.usage.outputTokens).toBe(1436 + 1388);
  });

  // `current_model_id` is what the conversation is running now; signals' `primaryModelId` is what
  // it has mostly run under, which is the WRONG answer for the rest of a session after `/model`.
  it("prefers the summary's current model to the one signals reports", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5-fast" });
    writeGrokSignals({ contextTokensUsed: 10, contextWindowTokens: 500_000, primaryModelId: "grok-4.5" });
    expect((await agentBadges(CWD, GROK_ID, "grok", roots)).context.model).toBe("grok-4.5-fast");
  });

  // grok writes the summary a little after it creates the directory, so this is a real state and
  // not a defensive one.
  it("falls back to the model signals names when there is no summary yet", async () => {
    writeGrokSignals({ contextTokensUsed: 10, contextWindowTokens: 500_000, primaryModelId: "grok-4.5" });
    expect((await agentBadges(CWD, GROK_ID, "grok", roots)).context.model).toBe("grok-4.5");
  });

  it("answers nothing for a grok session with no conversation directory", async () => {
    const badges = await agentBadges(CWD, GROK_ID, "grok", roots);
    expect(badges.context).toEqual({ model: null, contextTokens: 0, contextWindow: null });
    expect(badges.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  // The fold is resumed from a byte offset it remembered, so a turn appended after a first read
  // must be ADDED to what was already counted — not re-counted, and not missed.
  it("counts a turn appended after an earlier read exactly once", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5" });
    writeGrokUpdates([{ inputTokens: 100, outputTokens: 10 }]);
    expect((await agentBadges(CWD, GROK_ID, "grok", roots)).usage.outputTokens).toBe(10);
    writeGrokUpdates([
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
    ]);
    const badges = await agentBadges(CWD, GROK_ID, "grok", roots);
    expect(badges.usage).toEqual({ inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  // grok partitions by directory, so the cwd is part of the lookup: the same id under another
  // directory is a different conversation and must not answer for this one.
  it("does not read a grok conversation from another directory", async () => {
    writeGrokSummary({ current_model_id: "grok-4.5" });
    expect((await agentBadges("/Users/x/elsewhere", GROK_ID, "grok", roots)).context.model).toBeNull();
  });

  // agy answers from TWO stores: the model is prose in the transcript, the numbers are protobuf in
  // a database beside it. The id here IS the conversation id — the session -> conversation mapping
  // is codex's, already covered above, and asking for it in this spec would append a fake session
  // to the developer's real ~/.mulmoterminal log.
  it("reads an antigravity session's model from its transcript and its numbers from its database", async () => {
    writeAntigravityTranscript(AGY_ID, "The user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment.");
    writeAntigravityDb(AGY_ID, { used: 234_987, window: 256_000, prompt: 4901, output: 180, cached: 227_183 });
    const badges = await agentBadges(CWD, AGY_ID, "antigravity", roots);
    expect(badges.context).toEqual({ model: "Gemini 3.6 Flash (High)", contextTokens: 234_987, contextWindow: 256_000 });
    expect(badges.usage).toEqual({ inputTokens: 4901, outputTokens: 180, cacheReadTokens: 227_183, cacheCreationTokens: 0 });
  });

  // The stores are written at different moments: agy creates the transcript on the first prompt and
  // the database when the model first answers. Between the two, the model badge must still fill in.
  it("names the model with no numbers when the database is not there yet", async () => {
    writeAntigravityTranscript(AGY_ID, "The user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment.");
    const badges = await agentBadges(CWD, AGY_ID, "antigravity", roots);
    expect(badges.context).toEqual({ model: "Gemini 3.6 Flash (High)", contextTokens: 0 });
    expect(badges.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  // The session this badge is for has no transcript of its own — a cell that has not been typed
  // into yet, so agy has not created the conversation. Nobody is the answer, and the badge hides;
  // the model of whatever else ran in this directory is NOT the answer (#1468).
  it("names nobody for an antigravity session with no transcript of its own", async () => {
    writeAntigravityTranscript(AGY_ID, "The user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment.");
    const badges = await agentBadges(CWD, "8dcd4b0f-6d55-4a02-9f2c-1c4f2a7b9e10", "antigravity", roots);
    expect(badges.context).toEqual({ model: null, contextTokens: 0 });
    expect(badges.usage.inputTokens).toBe(0);
  });
});
