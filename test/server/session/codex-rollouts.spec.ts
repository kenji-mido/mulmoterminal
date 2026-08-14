// @vitest-environment node
// #1418: which codex rollout a session runs has to survive the PROCESS, which is the one thing a
// fold over lines cannot show. So this drives the registry's real log on a real disk — record in
// one "process", re-import and hydrate in the next — with HOME pointed at a temp directory.
//
// The sibling spec (agent-conversations.spec.ts) pins what a line MEANS; this pins that the line
// is actually written, actually read back, and read back into codex's log rather than agy's.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agentResumeId } from "../../../server/agents/agent-resume";

const SESSION = "bf488420-850f-4dcb-931c-727614d6eaf7";
const ROLLOUT = "9c2f0f8e-1a4b-4c7d-8e5f-0a1b2c3d4e5f";
const ROLLOUT_B = "1d3e5f70-2b4c-4d6e-9f80-a1b2c3d4e5f6";
const CWD = "/work/one";
const SETTLE_TIMEOUT_MS = 2000;

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "codex-rollout-home-"));
  vi.resetModules();
  // MULMOTERMINAL_HOME is derived from os.homedir() when env.ts is evaluated, so the mock has to
  // be in place before the first import — and every import after a resetModules re-reads it.
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return { ...actual, default: { ...actual, homedir: () => home }, homedir: () => home };
  });
});

afterEach(async () => {
  vi.doUnmock("node:os");
  vi.resetModules();
  await rm(home, { recursive: true, force: true });
});

/** A server process: a registry that has never seen this log before. */
async function bootRegistry() {
  vi.resetModules();
  return await import("../../../server/session/registry.js");
}

const logFile = (name: string) => path.join(home, ".mulmoterminal", name);

/** The append is chained behind a promise the caller cannot await, so wait for the bytes. */
async function awaitLogged(name: string, contains: string): Promise<void> {
  await vi.waitFor(async () => expect(await readFile(logFile(name), "utf8")).toContain(contains), { timeout: SETTLE_TIMEOUT_MS });
}

describe("the codex rollout log across a restart", () => {
  it("resumes a rollout recorded by a process that is gone — the bug this fixes", async () => {
    const before = await bootRegistry();
    before.rememberCodexRollout(SESSION, ROLLOUT, CWD);
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT);

    const after = await bootRegistry();
    await after.codexRolloutsHydrated;
    expect(after.codexRollouts.get(SESSION)?.conversationId).toBe(ROLLOUT);
  });

  // The cwd is what a resumed cell is spawned in, so losing it is not cosmetic.
  it("brings the cwd back with it", async () => {
    const before = await bootRegistry();
    before.rememberCodexRollout(SESSION, ROLLOUT, CWD);
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT);

    const after = await bootRegistry();
    await after.codexRolloutsHydrated;
    expect(after.codexRollouts.get(SESSION)?.cwd).toBe(CWD);
  });

  // The log only grows, so a session re-recorded in a later process appends rather than replaces.
  it("answers with the LAST rollout recorded for a session", async () => {
    const first = await bootRegistry();
    first.rememberCodexRollout(SESSION, ROLLOUT, CWD);
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT);

    const second = await bootRegistry();
    await second.codexRolloutsHydrated;
    second.rememberCodexRollout(SESSION, ROLLOUT_B, "/work/moved");
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT_B);

    const third = await bootRegistry();
    await third.codexRolloutsHydrated;
    expect(third.codexRollouts.get(SESSION)?.conversationId).toBe(ROLLOUT_B);
    expect(third.codexRollouts.get(SESSION)?.cwd).toBe("/work/moved");
  });

  // Also the guard that keeps the tests above honest: if `bootRegistry` handed back the SAME
  // module, the map would still hold the record and this would fail — so a pass upstairs really
  // did travel through the file.
  it("forgets a mapping whose log file is gone", async () => {
    const before = await bootRegistry();
    before.rememberCodexRollout(SESSION, ROLLOUT, CWD);
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT);
    await rm(logFile("codex-rollouts.jsonl"));

    const after = await bootRegistry();
    await after.codexRolloutsHydrated;
    expect(after.codexRollouts.get(SESSION)).toBeUndefined();
  });

  // Nothing was recorded, so the key is a mulmoterminal id naming no rollout. Declining is the
  // whole point of the guard: resuming anyway hands a stale id to `codex resume`.
  it("declines to resume a session it never recorded", async () => {
    const registry = await bootRegistry();
    await registry.codexRolloutsHydrated;
    const mappedId = registry.codexRollouts.get(SESSION)?.conversationId;
    expect(agentResumeId(SESSION, { mappedId, conversationExists: () => false, hasLivePty: false, tmuxAlive: false })).toBeNull();
  });
});

// One shape, two files. A codex rollout landing in agy's log would be handed to `agy --conversation`.
describe("the two agents' logs", () => {
  it("keeps codex out of the antigravity log", async () => {
    const before = await bootRegistry();
    before.rememberCodexRollout(SESSION, ROLLOUT, CWD);
    await awaitLogged("codex-rollouts.jsonl", ROLLOUT);

    const after = await bootRegistry();
    await Promise.all([after.codexRolloutsHydrated, after.antigravityConversationsHydrated]);
    expect(after.codexRollouts.get(SESSION)?.conversationId).toBe(ROLLOUT);
    expect(after.antigravityConversations.get(SESSION)).toBeUndefined();
  });

  it("keeps antigravity out of the codex log", async () => {
    const before = await bootRegistry();
    before.rememberAntigravityConversation(SESSION, ROLLOUT, CWD);
    await awaitLogged("antigravity-conversations.jsonl", ROLLOUT);

    const after = await bootRegistry();
    await Promise.all([after.codexRolloutsHydrated, after.antigravityConversationsHydrated]);
    expect(after.antigravityConversations.get(SESSION)?.conversationId).toBe(ROLLOUT);
    expect(after.codexRollouts.get(SESSION)).toBeUndefined();
  });
});
