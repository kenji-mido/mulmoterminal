// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listGrokSessions, parseGrokSummary, grokPromptTitles, grokModelFromSummary } from "../../../server/agents/grok-sessions.js";

// Captured from grok 0.2.118's own `summary.json`, trimmed to the fields the listing reads. The
// two timestamps disagree on purpose and that disagreement is the point: `updated_at` (and the
// file's mtime, which follows it) is bumped hours later when grok writes the generated title, so
// ordering by it puts a dead conversation above a live one.
const REAL_SUMMARY = JSON.stringify({
  info: { id: "019fcf22-289b-7773-b19c-462d5c08d061", cwd: "/Users/x/proj" },
  session_summary: "MCP Support Inquiry",
  created_at: "2026-08-04T23:35:50.328244Z",
  updated_at: "2026-08-05T05:01:20.335107Z",
  num_messages: 37,
  last_active_at: "2026-08-04T23:41:27.302406Z",
  generated_title: "MCP Support Inquiry",
});

const ID_A = "019fcf22-289b-7773-b19c-462d5c08d061";
const ID_B = "019fd000-0000-7000-8000-00000000000b";
const CWD = "/Users/x/my proj";

describe("parseGrokSummary", () => {
  it("reads the title and the last ACTIVE time out of a real summary.json", () => {
    const summary = parseGrokSummary(REAL_SUMMARY);
    expect(summary.title).toBe("MCP Support Inquiry");
    expect(summary.mtime).toBe(Date.parse("2026-08-04T23:41:27.302406Z"));
  });

  it("prefers the generated title, then the summary, then nothing", () => {
    expect(parseGrokSummary(JSON.stringify({ generated_title: "gen", session_summary: "sum" })).title).toBe("gen");
    // Measured on a real conversation that ended before grok generated a title: the field is
    // present and EMPTY, which is why a truthiness test and not a presence test.
    expect(parseGrokSummary(JSON.stringify({ generated_title: "", session_summary: "sum" })).title).toBe("sum");
    expect(parseGrokSummary(JSON.stringify({ generated_title: "", session_summary: "" })).title).toBeNull();
  });

  it("falls back through the timestamps, and reads a broken file as nothing", () => {
    expect(parseGrokSummary(JSON.stringify({ updated_at: "2026-08-05T05:00:00Z" })).mtime).toBe(Date.parse("2026-08-05T05:00:00Z"));
    expect(parseGrokSummary(JSON.stringify({ created_at: "2026-08-05T05:00:00Z" })).mtime).toBe(Date.parse("2026-08-05T05:00:00Z"));
    expect(parseGrokSummary(JSON.stringify({ last_active_at: "not a date" })).mtime).toBeNull();
    expect(parseGrokSummary("{oops")).toEqual({ title: null, mtime: null });
  });
});

describe("grokModelFromSummary", () => {
  // What the header's model badge shows for a grok cell (#1465). The real file carries it as
  // `current_model_id`; a conversation that has not recorded one wears no badge rather than a
  // guess, which is the same rule the Claude path follows before its first turn.
  it("reads the current model id, and nothing when there is none", () => {
    expect(grokModelFromSummary(JSON.stringify({ ...JSON.parse(REAL_SUMMARY), current_model_id: "grok-4.5" }))).toBe("grok-4.5");
    expect(grokModelFromSummary(REAL_SUMMARY)).toBeNull();
    expect(grokModelFromSummary(JSON.stringify({ current_model_id: "" }))).toBeNull();
    expect(grokModelFromSummary("{oops")).toBeNull();
  });
});

describe("listGrokSessions", () => {
  let root = "";

  const writeConversation = (cwd: string, id: string, summary: unknown | null) => {
    const dir = path.join(root, encodeURIComponent(cwd), id);
    fs.mkdirSync(dir, { recursive: true });
    if (summary !== null) fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary));
  };

  const writePromptHistory = (cwd: string, lines: unknown[]) => {
    const dir = path.join(root, encodeURIComponent(cwd));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt_history.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-sessions-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists the cwd's conversations newest first", async () => {
    writeConversation(CWD, ID_A, { generated_title: "older", last_active_at: "2026-08-01T00:00:00Z" });
    writeConversation(CWD, ID_B, { generated_title: "newer", last_active_at: "2026-08-02T00:00:00Z" });
    expect(await listGrokSessions(root, CWD, 10)).toEqual([
      { id: ID_B, title: "newer", mtime: Date.parse("2026-08-02T00:00:00Z") },
      { id: ID_A, title: "older", mtime: Date.parse("2026-08-01T00:00:00Z") },
    ]);
  });

  // The silent failure of this whole integration: the directory name IS the encoded cwd, so a
  // mismatch finds nothing, logs nothing and throws nothing — the user just gets an empty list
  // and a brand-new conversation. A space and a non-ASCII segment are what encodeURIComponent
  // handles and a naive replace does not.
  it("finds a directory whose cwd has a space and non-ASCII characters", async () => {
    const awkward = "/Users/x/grok enc-test/日本語-dir";
    writeConversation(awkward, ID_A, { generated_title: "found", last_active_at: "2026-08-01T00:00:00Z" });
    expect(await listGrokSessions(root, awkward, 10)).toEqual([{ id: ID_A, title: "found", mtime: Date.parse("2026-08-01T00:00:00Z") }]);
  });

  it("does not list another directory's conversations", async () => {
    writeConversation("/Users/x/other", ID_A, { generated_title: "elsewhere", last_active_at: "2026-08-01T00:00:00Z" });
    expect(await listGrokSessions(root, CWD, 10)).toEqual([]);
  });

  it("falls back to the cwd's prompt history when the summary has no title", async () => {
    writeConversation(CWD, ID_A, { session_summary: "", last_active_at: "2026-08-01T00:00:00Z" });
    writePromptHistory(CWD, [
      { timestamp: "2026-08-01T00:00:00Z", session_id: ID_A, prompt: "ls -la", is_bash: true },
      { timestamp: "2026-08-01T00:00:01Z", session_id: ID_A, prompt: "the first real prompt", is_bash: false },
      { timestamp: "2026-08-01T00:00:02Z", session_id: ID_A, prompt: "a later one", is_bash: false },
    ]);
    const [row] = await listGrokSessions(root, CWD, 10);
    expect(row?.title).toBe("the first real prompt");
  });

  // A conversation grok has created but not yet summarised is still resumable, so it is kept under
  // a default name — a listing that silently drops the session the user just started is worse.
  it("keeps a conversation whose summary cannot be read", async () => {
    writeConversation(CWD, ID_A, null);
    const [row] = await listGrokSessions(root, CWD, 10);
    expect(row?.id).toBe(ID_A);
    expect(row?.title).toBe("Grok session");
  });

  // grok creates the directory before it writes a summary, so the conversation with no readable
  // summary is typically the one just started. Stamping it 0 would sort it below every old row and
  // straight out of the limit — the newest conversation missing from the list it is newest in.
  it("dates a summary-less conversation by its directory, not by zero", async () => {
    writeConversation(CWD, ID_A, { generated_title: "old but summarised", last_active_at: "2020-01-01T00:00:00Z" });
    writeConversation(CWD, ID_B, null);
    const rows = await listGrokSessions(root, CWD, 10);
    expect(rows.map((r) => r.id)).toEqual([ID_B, ID_A]);
    expect(rows[0]?.mtime).toBeGreaterThan(Date.parse("2020-01-01T00:00:00Z"));
  });

  it("ignores the files that sit beside the conversation directories", async () => {
    writeConversation(CWD, ID_A, { generated_title: "real", last_active_at: "2026-08-01T00:00:00Z" });
    const dir = path.join(root, encodeURIComponent(CWD));
    fs.writeFileSync(path.join(dir, "prompt_history.jsonl"), "");
    fs.mkdirSync(path.join(dir, "not-a-uuid"));
    expect((await listGrokSessions(root, CWD, 10)).map((s) => s.id)).toEqual([ID_A]);
  });

  it("answers an unknown directory, and a missing root, with an empty list", async () => {
    expect(await listGrokSessions(root, "/nope", 10)).toEqual([]);
    expect(await listGrokSessions(path.join(root, "gone"), CWD, 10)).toEqual([]);
  });

  it("honours the limit", async () => {
    writeConversation(CWD, ID_A, { generated_title: "a", last_active_at: "2026-08-01T00:00:00Z" });
    writeConversation(CWD, ID_B, { generated_title: "b", last_active_at: "2026-08-02T00:00:00Z" });
    expect((await listGrokSessions(root, CWD, 1)).map((s) => s.title)).toEqual(["b"]);
  });
});

describe("grokPromptTitles", () => {
  let root = "";
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-prompts-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is empty when the directory has no prompt history", () => {
    expect(grokPromptTitles(root, CWD).size).toBe(0);
  });

  it("skips a corrupt line rather than losing the file", () => {
    const dir = path.join(root, encodeURIComponent(CWD));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt_history.jsonl"), `{oops\n${JSON.stringify({ session_id: ID_A, prompt: "kept" })}\n`);
    expect(grokPromptTitles(root, CWD).get(ID_A)).toBe("kept");
  });
});
