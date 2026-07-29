// Permanent session delete (remote/mobile work) — the destructive counterpart to hiding.
//
// This is the one piece of the fork's work that removes a user's data, so what the tests pin is
// the blast radius: the id it was ASKED for and nothing adjacent. A port that widens this (a
// prefix match, a glob, a whole-directory sweep) has to fail here.
//
// `node:os` is mocked to a temp home so the scan runs over a fake ~/.claude/projects instead of
// the real transcripts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const { HOME } = vi.hoisted(() => ({ HOME: `/tmp/mt-transcript-delete-${crypto.randomUUID()}` }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual.default, homedir: () => HOME }, homedir: () => HOME };
});

const PROJECTS = path.join(HOME, ".claude", "projects");
const CODEX_SESSIONS = path.join(HOME, ".codex-test", "sessions");
const A = "01234567-89ab-cdef-0123-456789abcdef";
const B = "fedcba98-7654-3210-fedc-ba9876543210";

const transcript = (project: string, id: string) => path.join(PROJECTS, project, `${id}.jsonl`);
const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

async function writeTranscript(project: string, id: string) {
  await fs.mkdir(path.join(PROJECTS, project), { recursive: true });
  await fs.writeFile(transcript(project, id), '{"type":"user"}\n');
}

// codexSessionsRoot() reads CODEX_HOME, so the rollout scan is pointed at a temp tree the same
// way the transcript scan is.
async function writeCodexRollout(id: string) {
  const day = path.join(CODEX_SESSIONS, "2026", "07", "29");
  await fs.mkdir(day, { recursive: true });
  const file = path.join(day, `rollout-2026-07-29T10-00-00-${id}.jsonl`);
  await fs.writeFile(file, "{}\n");
  return file;
}

async function deleteTranscripts(id: string): Promise<boolean> {
  vi.resetModules();
  const { deleteSessionTranscripts } = await import("../../../server/session/transcript-delete.js");
  return deleteSessionTranscripts(id);
}

describe("deleteSessionTranscripts", () => {
  beforeEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
    process.env.CODEX_HOME = path.dirname(CODEX_SESSIONS);
  });
  afterEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
    delete process.env.CODEX_HOME;
  });

  it("removes the session's transcript and says so", async () => {
    await writeTranscript("-home-u-app", A);
    expect(await deleteTranscripts(A)).toBe(true);
    expect(await exists(transcript("-home-u-app", A))).toBe(false);
  });

  // The id is a UUID and the caller does not know which project it belongs to — finding it is
  // the whole reason this scans.
  it("finds the transcript whichever project directory holds it", async () => {
    await writeTranscript("-home-u-first", B);
    await writeTranscript("-home-u-second", A);
    expect(await deleteTranscripts(A)).toBe(true);
    expect(await exists(transcript("-home-u-second", A))).toBe(false);
  });

  // The blast-radius test. Everything else in the store must be untouched.
  it("deletes ONLY the id it was given", async () => {
    await writeTranscript("-home-u-app", A);
    await writeTranscript("-home-u-app", B);
    await writeTranscript("-home-u-other", B);
    await deleteTranscripts(A);
    expect(await exists(transcript("-home-u-app", B))).toBe(true);
    expect(await exists(transcript("-home-u-other", B))).toBe(true);
  });

  it("is idempotent — a second delete reports nothing removed instead of throwing", async () => {
    await writeTranscript("-home-u-app", A);
    expect(await deleteTranscripts(A)).toBe(true);
    expect(await deleteTranscripts(A)).toBe(false);
  });

  it("reports false for an id that was never on disk", async () => {
    await writeTranscript("-home-u-app", B);
    expect(await deleteTranscripts(A)).toBe(false);
    expect(await exists(transcript("-home-u-app", B))).toBe(true);
  });

  it("survives a missing ~/.claude/projects rather than throwing", async () => {
    expect(await deleteTranscripts(A)).toBe(false);
  });

  // A codex session's conversation lives in its own rollout file; leaving it behind would keep
  // the session resumable after the user asked for it to be gone.
  it("removes the codex rollout for the same id", async () => {
    const rollout = await writeCodexRollout(A);
    expect(await deleteTranscripts(A)).toBe(true);
    expect(await exists(rollout)).toBe(false);
  });

  it("leaves another session's codex rollout alone", async () => {
    const keep = await writeCodexRollout(B);
    await writeTranscript("-home-u-app", A);
    await deleteTranscripts(A);
    expect(await exists(keep)).toBe(true);
  });
});
