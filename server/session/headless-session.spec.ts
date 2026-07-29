import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HEADLESS_SESSION_PREFIX,
  isHeadlessSessionId,
  newHeadlessSessionId,
  removeHeadlessTranscript,
  sweepOrphanHeadlessTranscripts,
} from "./headless-session.js";
import { isProbeSessionId, newProbeSessionId } from "../agents/probe-session.js";
import { projectSessionsDir } from "./project-dir.js";

describe("headless session ids", () => {
  it("recognises what it mints", () => {
    expect(isHeadlessSessionId(newHeadlessSessionId())).toBe(true);
    expect(isHeadlessSessionId(`${HEADLESS_SESSION_PREFIX}4000-8000-000000000000`)).toBe(true);
  });

  it("is a syntactically valid v4-shaped uuid (--session-id and SESSION_ID_RE require one)", () => {
    expect(newHeadlessSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("leaves a real conversation alone", () => {
    expect(isHeadlessSessionId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(false);
    expect(isHeadlessSessionId("")).toBe(false);
  });

  // The two kinds of internal session must stay distinguishable: they are cleaned up by different
  // code with different rules (the probe sweeps once on content, this one every boot by name).
  it("does not answer for a probe's id, nor the probe for one of ours", () => {
    expect(isHeadlessSessionId(newProbeSessionId())).toBe(false);
    expect(isProbeSessionId(newHeadlessSessionId())).toBe(false);
  });

  // The id becomes `<sessions-dir>/<id>.jsonl` and that file gets deleted, so a "starts with"
  // match would let a path segment through — see internal-session-id.ts.
  it("rejects anything that could escape the sessions directory", () => {
    for (const bad of [
      `${HEADLESS_SESSION_PREFIX}../../../../etc/passwd`,
      `${HEADLESS_SESSION_PREFIX}4000-8000-000000000000/../../secret`,
      `${HEADLESS_SESSION_PREFIX}..`,
      `${HEADLESS_SESSION_PREFIX}4000-8000-00000000000\\..\\win`,
      HEADLESS_SESSION_PREFIX,
      `${HEADLESS_SESSION_PREFIX}4000-8000-000000000000-extra`,
      `${HEADLESS_SESSION_PREFIX}4000-8000-00000000000g`,
      ` ${HEADLESS_SESSION_PREFIX}4000-8000-000000000000`,
      `${HEADLESS_SESSION_PREFIX}4000-8000-000000000000\n`,
    ]) {
      expect(isHeadlessSessionId(bad)).toBe(false);
    }
  });
});

// The sweep and the delete run against a real directory: what they must never do is take a file
// that is not ours, and that is a property of the filesystem call, not of a pure function.
describe("headless transcript cleanup", () => {
  let workspace: string;
  let sessionsDir: string;
  const write = async (id: string) => {
    await fs.writeFile(path.join(sessionsDir, `${id}.jsonl`), "{}\n");
    return `${id}.jsonl`;
  };
  const listing = () => fs.readdir(sessionsDir);

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mt-headless-"));
    sessionsDir = projectSessionsDir(workspace);
    await fs.mkdir(sessionsDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(sessionsDir, { recursive: true, force: true });
  });

  it("deletes the run's own transcript", async () => {
    const id = newHeadlessSessionId();
    await write(id);
    expect(await removeHeadlessTranscript(workspace, id)).toBe(true);
    expect(await listing()).toEqual([]);
  });

  it("refuses an id that is not a headless run's, whatever the caller passes", async () => {
    const real = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const file = await write(real);
    expect(await removeHeadlessTranscript(workspace, real)).toBe(false);
    expect(await listing()).toEqual([file]);
  });

  it("reports false rather than throwing when there is no such transcript", async () => {
    expect(await removeHeadlessTranscript(workspace, newHeadlessSessionId())).toBe(false);
  });

  it("sweeps orphans left by runs that never cleaned up, and nothing else", async () => {
    await write(newHeadlessSessionId());
    await write(newHeadlessSessionId());
    const chat = await write("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    const probe = await write(newProbeSessionId()); // the probe's own sweep owns these
    await fs.writeFile(path.join(sessionsDir, "notes.txt"), "not a transcript");

    expect(await sweepOrphanHeadlessTranscripts(workspace)).toBe(2);
    expect((await listing()).sort()).toEqual([chat, "notes.txt", probe].sort());
  });

  it("returns 0 for a project with no transcripts at all", async () => {
    expect(await sweepOrphanHeadlessTranscripts(path.join(workspace, "never-used"))).toBe(0);
  });
});
