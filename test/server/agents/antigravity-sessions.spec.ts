// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { antigravityTitleFromTranscriptHead, antigravityTranscriptPath, listAntigravitySessions } from "../../../server/agents/antigravity-sessions.js";
import type { AntigravityConversation } from "../../../server/session/antigravity-conversations.js";

// Captured verbatim from agy 1.1.9 (`agy -p`), so a format change breaks this rather than
// quietly renaming every row. The point of the fixture is the wrapping: the prompt is inside
// <USER_REQUEST>, and agy appends two blocks of its own that must never reach the sidebar.
const REAL_TRANSCRIPT_HEAD =
  '{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-08-01T09:16:59Z","content":"<USER_REQUEST>\\nReply with exactly the word OK.\\nSecond line of the prompt.\\n</USER_REQUEST>\\n<ADDITIONAL_METADATA>\\nThe current local time is: 2026-08-01T18:16:59+09:00.\\n</ADDITIONAL_METADATA>\\n<USER_SETTINGS_CHANGE>\\nThe user changed setting `Model Selection` from None to Gemini 3.6 Flash (High). No need to comment on this change if the user doesn\'t ask about it. If reporting what model you are, please use a human readable name instead of the exact string.\\n</USER_SETTINGS_CHANGE>"}\n' +
  '{"step_index":1,"source":"SYSTEM","type":"CONVERSATION_HISTORY","status":"DONE","created_at":"2026-08-01T09:16:59Z"}\n';

const userInput = (content: string) => `${JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content })}\n`;

describe("antigravityTitleFromTranscriptHead", () => {
  it("takes only the prompt out of a real agy transcript", () => {
    expect(antigravityTitleFromTranscriptHead(REAL_TRANSCRIPT_HEAD)).toBe("Reply with exactly the word OK. Second line of the prompt.");
  });

  it("keeps agy's appended blocks out of the title", () => {
    const title = antigravityTitleFromTranscriptHead(REAL_TRANSCRIPT_HEAD);
    expect(title).not.toContain("local time");
    expect(title).not.toContain("Model Selection");
    expect(title).not.toContain("USER_REQUEST");
  });

  it("truncates a long prompt", () => {
    const title = antigravityTitleFromTranscriptHead(userInput(`<USER_REQUEST>\n${"x".repeat(200)}\n</USER_REQUEST>`));
    expect(title).toHaveLength(60);
  });

  it("skips steps that carry no content", () => {
    const head = '{"step_index":0,"type":"CONVERSATION_HISTORY","source":"SYSTEM"}\n' + userInput("<USER_REQUEST>\nthe real prompt\n</USER_REQUEST>");
    expect(antigravityTitleFromTranscriptHead(head)).toBe("the real prompt");
  });

  it("skips a corrupt line and a truncated final line", () => {
    const head = "not json at all\n" + userInput("<USER_REQUEST>\nfrom a good line\n</USER_REQUEST>") + '{"step_index":2,"type":"USER_IN';
    expect(antigravityTitleFromTranscriptHead(head)).toBe("from a good line");
  });

  it("falls back to a default when there is no user input", () => {
    expect(antigravityTitleFromTranscriptHead('{"step_index":0,"type":"PLANNER_RESPONSE","source":"MODEL","content":"hi"}\n')).toBe("Antigravity session");
    expect(antigravityTitleFromTranscriptHead("")).toBe("Antigravity session");
  });

  it("still drops the known blocks if the request wrapper ever goes away", () => {
    const head = userInput("bare prompt\n<ADDITIONAL_METADATA>\nThe current local time is: now.\n</ADDITIONAL_METADATA>");
    expect(antigravityTitleFromTranscriptHead(head)).toBe("bare prompt");
  });
});

describe("listAntigravitySessions", () => {
  const tmpDir = path.join(os.tmpdir(), `ag-sessions-test-${Date.now()}`);
  const brainDir = path.join(tmpDir, "brain");
  const CWD = "/work/project";
  const ID_A = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
  const ID_B = "5fd4f183-39d4-4842-8e03-114e966e7fa5";
  const ID_C = "7c1f0f6c-2b8e-4a5a-9d3e-0f2a1b3c4d5e";

  const record = (over: Partial<AntigravityConversation> = {}): AntigravityConversation => ({
    sessionId: "11111111-1111-4111-8111-111111111111",
    conversationId: ID_A,
    cwd: CWD,
    startedAt: 1000,
    ...over,
  });

  function writeConversation(id: string, prompt: string, mtime?: Date) {
    const file = antigravityTranscriptPath(brainDir, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, userInput(`<USER_REQUEST>\n${prompt}\n</USER_REQUEST>`));
    if (mtime) fs.utimesSync(file, mtime, mtime);
  }

  beforeEach(() => fs.mkdirSync(brainDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("lists a conversation with the title from its transcript", async () => {
    writeConversation(ID_A, "fix the login bug");
    const sessions = await listAntigravitySessions(brainDir, [record()], CWD, 50);
    expect(sessions).toEqual([{ id: ID_A, title: "fix the login bug", mtime: expect.any(Number) }]);
  });

  it("keeps only the conversations started in this cwd", async () => {
    writeConversation(ID_A, "mine");
    writeConversation(ID_B, "someone else's project");
    const records = [record(), record({ conversationId: ID_B, cwd: "/work/other" })];
    expect(await listAntigravitySessions(brainDir, records, CWD, 50)).toEqual([expect.objectContaining({ id: ID_A })]);
  });

  it("drops a conversation agy no longer holds", async () => {
    writeConversation(ID_A, "still here");
    const records = [record(), record({ conversationId: ID_B, sessionId: "22222222-2222-4222-8222-222222222222" })];
    expect(await listAntigravitySessions(brainDir, records, CWD, 50)).toEqual([expect.objectContaining({ id: ID_A })]);
  });

  it("lists one row per conversation even when several session keys map to it", async () => {
    writeConversation(ID_A, "one conversation");
    const records = [record({ startedAt: 1000 }), record({ sessionId: "22222222-2222-4222-8222-222222222222", startedAt: 2000 })];
    expect(await listAntigravitySessions(brainDir, records, CWD, 50)).toHaveLength(1);
  });

  it("sorts newest first and honours the limit", async () => {
    writeConversation(ID_A, "oldest", new Date(1_000_000));
    writeConversation(ID_B, "middle", new Date(2_000_000));
    writeConversation(ID_C, "newest", new Date(3_000_000));
    const records = [
      record({ conversationId: ID_A }),
      record({ conversationId: ID_B, sessionId: "22222222-2222-4222-8222-222222222222" }),
      record({ conversationId: ID_C, sessionId: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect((await listAntigravitySessions(brainDir, records, CWD, 50)).map((s) => s.title)).toEqual(["newest", "middle", "oldest"]);
    expect(await listAntigravitySessions(brainDir, records, CWD, 2)).toHaveLength(2);
  });

  // agy writes the directory and the transcript together on the first user input, so this is a
  // format change, not a state agy produces. The row stays resumable rather than vanishing.
  it("keeps a resumable row when the transcript cannot be read", async () => {
    fs.mkdirSync(path.join(brainDir, ID_A), { recursive: true });
    const sessions = await listAntigravitySessions(brainDir, [record({ startedAt: 4242 })], CWD, 50);
    expect(sessions).toEqual([{ id: ID_A, title: "Antigravity session", mtime: 4242 }]);
  });

  it("is empty when nothing ran in this cwd", async () => {
    expect(await listAntigravitySessions(brainDir, [], CWD, 50)).toEqual([]);
  });

  // The log only grows and nothing prunes it, so without a bound every session-list refresh would
  // do filesystem work proportional to every agy conversation ever started in the directory.
  //
  // The oldest-STARTED conversations are given the newest mtimes, which is what makes this test
  // able to fail: an implementation that reads every record would rank exactly those first, so
  // their absence from the answer is proof that the window is applied before the filesystem.
  it("never reads the conversations outside the newest-started window", async () => {
    const uuid = (i: number) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`;
    const OUTSIDE = 60; // 260 records against a 200-wide window
    const records = Array.from({ length: 260 }, (_, i) => record({ sessionId: uuid(i), conversationId: uuid(i), startedAt: i }));
    for (let i = 0; i < 260; i++) writeConversation(uuid(i), `prompt ${i}`, new Date(i < OUTSIDE ? 9_000_000 + i : 1_000_000 + i));

    const sessions = await listAntigravitySessions(brainDir, records, CWD, 50);
    expect(sessions).toHaveLength(50);
    expect(sessions.filter((s) => Number(s.id.slice(0, 8)) < OUTSIDE)).toEqual([]);
    expect(sessions[0].title).toBe("prompt 259");
  });
});
