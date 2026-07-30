// @vitest-environment node
// The log that maps a MulmoTerminal session to the agy conversation it is running (#1096). It is
// what makes a conversation reachable after a restart, it is written by several instances at once,
// and it is read by builds older and newer than the one that wrote it — so what a line means, and
// what an unusable one costs, is pinned here.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forEachJsonlRecord } from "../../../server/infra/jsonl-file";
import {
  antigravityConversationLine,
  antigravityConversationRecord,
  applyAntigravityConversation,
  hydrateAntigravityConversationInto,
  type AntigravityConversation,
} from "../../../server/session/antigravity-conversations";
import { agentResumeId } from "../../../server/agents/agent-resume";

const SESSION_A = "bf488420-850f-4dcb-931c-727614d6eaf7";
const SESSION_B = "33149419-234b-4d31-bd8c-341290f4c090";
const CONVERSATION_A = "9c2f0f8e-1a4b-4c7d-8e5f-0a1b2c3d4e5f";
const CONVERSATION_B = "1d3e5f70-2b4c-4d6e-9f80-a1b2c3d4e5f6";
const isValidId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

const record = (over: Partial<AntigravityConversation> = {}): AntigravityConversation => ({
  sessionId: SESSION_A,
  conversationId: CONVERSATION_A,
  cwd: "/work/one",
  startedAt: 1_700_000_000_000,
  ...over,
});

// Exactly what the registry does with the file, through the SAME reader — a hand-rolled
// split/parse here would be a paraphrase of forEachJsonlRecord, and the two could drift apart
// (CRLF, blank lines, a line holding a bare array) while these tests kept passing (CodeRabbit).
let logDir: string;
let logSeq = 0;

beforeAll(async () => {
  logDir = await mkdtemp(path.join(tmpdir(), "antigravity-log-"));
});

afterAll(async () => {
  await rm(logDir, { recursive: true, force: true });
});

async function foldLog(contents: string): Promise<Map<string, AntigravityConversation>> {
  const file = path.join(logDir, `log-${logSeq++}.jsonl`);
  await writeFile(file, contents);
  const conversations = new Map<string, AntigravityConversation>();
  await forEachJsonlRecord(file, (parsed) => {
    const found = antigravityConversationRecord(parsed, isValidId);
    if (found) applyAntigravityConversation(conversations, found);
  });
  return conversations;
}

describe("antigravityConversationLine", () => {
  it("round-trips through the parser", async () => {
    expect((await foldLog(antigravityConversationLine(record()))).get(SESSION_A)).toEqual(record());
  });

  it("keeps a cwd that contains spaces — the reason this is JSON and not a split line", async () => {
    const line = antigravityConversationLine(record({ cwd: "/work/my project" }));
    expect((await foldLog(line)).get(SESSION_A)?.cwd).toBe("/work/my project");
  });

  it("ends its own line, so the next append cannot weld onto it", async () => {
    const log = `${antigravityConversationLine(record())}${antigravityConversationLine(record({ sessionId: SESSION_B, conversationId: CONVERSATION_B }))}`;
    expect([...(await foldLog(log)).keys()]).toEqual([SESSION_A, SESSION_B]);
  });
});

describe("antigravityConversationRecord", () => {
  it.each([
    ["no sessionId", { conversationId: CONVERSATION_A, cwd: "/work/one" }],
    ["a sessionId that is not an id", { sessionId: "nope", conversationId: CONVERSATION_A, cwd: "/work/one" }],
    ["no conversationId", { sessionId: SESSION_A, cwd: "/work/one" }],
    ["a conversationId that is not an id", { sessionId: SESSION_A, conversationId: "nope", cwd: "/work/one" }],
    ["no cwd", { sessionId: SESSION_A, conversationId: CONVERSATION_A }],
    ["an empty cwd", { sessionId: SESSION_A, conversationId: CONVERSATION_A, cwd: "" }],
  ])("drops a record with %s rather than guessing", (_label, parsed) => {
    expect(antigravityConversationRecord(parsed, isValidId)).toBeNull();
  });

  // startedAt is only ever displayed. Dropping the line over it would throw away the id mapping,
  // which is the one thing that makes the conversation reachable again.
  it("keeps a record whose startedAt is missing or unusable", () => {
    const parsed = { sessionId: SESSION_A, conversationId: CONVERSATION_A, cwd: "/work/one", startedAt: "yesterday" };
    expect(antigravityConversationRecord(parsed, isValidId)).toEqual(record({ startedAt: 0 }));
  });

  // The logs live side by side in ~/.mulmoterminal, and a build reads whichever it is pointed at.
  it.each([
    ["the id log next door", `\n${SESSION_A}`],
    ["a memo log line", JSON.stringify({ id: SESSION_A, text: "note", at: 1 })],
    ["a torn last line", `${antigravityConversationLine(record())}{"sessionId":"${SESSION_B}`],
  ])("reads nothing usable out of %s", async (_label, contents) => {
    expect([...(await foldLog(contents)).keys()]).not.toContain(SESSION_B);
  });

  it("still keeps the good lines around a broken one", async () => {
    const log = `not json\n${antigravityConversationLine(record())}{"sessionId":"truncated`;
    expect([...(await foldLog(log)).keys()]).toEqual([SESSION_A]);
  });
});

// The log only grows — a session relaunched elsewhere, or resumed after its cell moved, appends a
// second line rather than replacing the first.
describe("applyAntigravityConversation", () => {
  it("lets the last line for a session win", async () => {
    const log = `${antigravityConversationLine(record({ cwd: "/work/old" }))}${antigravityConversationLine(record({ cwd: "/work/new" }))}`;
    expect((await foldLog(log)).get(SESSION_A)?.cwd).toBe("/work/new");
  });

  it("keeps sessions apart", async () => {
    const log = `${antigravityConversationLine(record())}${antigravityConversationLine(record({ sessionId: SESSION_B, conversationId: CONVERSATION_B }))}`;
    const conversations = await foldLog(log);
    expect(conversations.get(SESSION_A)?.conversationId).toBe(CONVERSATION_A);
    expect(conversations.get(SESSION_B)?.conversationId).toBe(CONVERSATION_B);
  });
});

// Hydration reads the file as it was BEFORE this process's append could reach it, so a session
// spawned while it was still reading must keep the record the spawn wrote.
describe("hydrateAntigravityConversationInto", () => {
  it("fills what is missing", () => {
    const conversations = new Map<string, AntigravityConversation>();
    hydrateAntigravityConversationInto(conversations, new Set(), record());
    expect(conversations.get(SESSION_A)).toEqual(record());
  });

  it("does not overwrite a session recorded while it was reading", () => {
    const conversations = new Map([[SESSION_A, record({ cwd: "/work/live" })]]);
    hydrateAntigravityConversationInto(conversations, new Set([SESSION_A]), record({ cwd: "/work/from-disk" }));
    expect(conversations.get(SESSION_A)?.cwd).toBe("/work/live");
  });

  it("still fills the OTHER sessions in the same file", () => {
    const conversations = new Map([[SESSION_A, record({ cwd: "/work/live" })]]);
    const written = new Set([SESSION_A]);
    hydrateAntigravityConversationInto(conversations, written, record({ cwd: "/work/from-disk" }));
    hydrateAntigravityConversationInto(conversations, written, record({ sessionId: SESSION_B, conversationId: CONVERSATION_B }));
    expect(conversations.get(SESSION_A)?.cwd).toBe("/work/live");
    expect(conversations.get(SESSION_B)?.conversationId).toBe(CONVERSATION_B);
  });
});

// What the log is FOR, composed the way resolveAntigravitySession composes it: the hydrated
// mapping feeds agentResumeId's `mappedId`. `agy` cannot be run here, so this pins the decision
// rather than the resume itself — and the decision is the only part #1096 changes.
describe("a hydrated log as agentResumeId's mappedId", () => {
  const coldFacts = { conversationExists: () => false, hasLivePty: false, tmuxAlive: false };

  it("resumes a session whose mapping only exists on disk — the restart this log is for", async () => {
    const conversations = await foldLog(antigravityConversationLine(record()));
    expect(agentResumeId(SESSION_A, { ...coldFacts, mappedId: conversations.get(SESSION_A)?.conversationId })).toBe(CONVERSATION_A);
  });

  it("resumes the LAST conversation recorded for a session, not the first", async () => {
    const log = `${antigravityConversationLine(record())}${antigravityConversationLine(record({ conversationId: CONVERSATION_B }))}`;
    const conversations = await foldLog(log);
    expect(agentResumeId(SESSION_A, { ...coldFacts, mappedId: conversations.get(SESSION_A)?.conversationId })).toBe(CONVERSATION_B);
  });

  // The guard that makes an empty or corrupt log cost a resume rather than the WRONG conversation.
  it("declines to resume an unmapped key that names no conversation on disk", async () => {
    const conversations = await foldLog("");
    expect(agentResumeId(SESSION_B, { ...coldFacts, mappedId: conversations.get(SESSION_B)?.conversationId })).toBeNull();
  });

  // The sidebar hands over a conversation id directly; that path must survive an empty log.
  it("still resumes a key that IS a conversation on disk", async () => {
    const conversations = await foldLog("");
    const facts = { ...coldFacts, conversationExists: () => true, mappedId: conversations.get(CONVERSATION_A)?.conversationId };
    expect(agentResumeId(CONVERSATION_A, facts)).toBe(CONVERSATION_A);
  });

  it("does not carry a resume id into a reattach of a live session", async () => {
    const conversations = await foldLog(antigravityConversationLine(record()));
    const facts = { ...coldFacts, hasLivePty: true, mappedId: conversations.get(SESSION_A)?.conversationId };
    expect(agentResumeId(SESSION_A, facts)).toBeNull();
  });
});
