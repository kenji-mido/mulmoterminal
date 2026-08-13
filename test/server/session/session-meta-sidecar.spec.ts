// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";

// #1379 made the session list resume its fold instead of repeating it, but that state lives in one
// process's memory: a restart, and every other mulmoterminal on the machine, still paid for the
// whole transcript. These pin the disk half — what a SECOND process sees (#1386).
//
// A fresh module registry is what stands in for that second process: `vi.resetModules()` gives a
// reader whose in-memory cache has never seen the file, against the same home and the same
// transcript on disk.

let scratch: ScratchHome;
let home = "";
let projects = "";
let n = 0;

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const userLine = (text: string) => line({ type: "user", message: { content: text } });
const aiTitleLine = (title: string) => line({ type: "ai-title", aiTitle: title });
const promptLine = (text: string) => line({ type: "last-prompt", lastPrompt: text });
const fillerLine = (bytes: number) => line({ type: "assistant", text: "x".repeat(bytes) });

const OVER_THRESHOLD_BYTES = 11 * 1024 * 1024;

async function freshReader() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/session-reads.js");
  return mod.readSessionMeta;
}

const projectDir = () => path.join(projects, "-Users-me-proj");

function writeTranscript(body: string): string {
  mkdirSync(projectDir(), { recursive: true });
  const file = `sess-${++n}.jsonl`;
  writeFileSync(path.join(projectDir(), file), body);
  return file;
}

const titleFrom = async (file: string) => {
  const readSessionMeta = await freshReader();
  return (await readSessionMeta(projectDir(), file)).title;
};

// The write is fire-and-forget, so a test that expects the file has to let it land.
const settled = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5));
};

const sidecarsWritten = (): string[] => {
  const root = path.join(home, ".mulmoterminal", "transcript-index");
  return existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map(String)
        .filter((e) => e.endsWith(".json"))
    : [];
};

beforeEach(() => {
  scratch = takeScratchHome("mt-meta-sidecar-");
  home = scratch.path;
  projects = path.join(home, ".claude", "projects");
  mkdirSync(projects, { recursive: true });
});
afterEach(() => scratch.release());

describe("the session list across processes", () => {
  it("answers a big transcript from the sidecar, without reading it again", async () => {
    const file = writeTranscript(userLine("what I asked") + fillerLine(OVER_THRESHOLD_BYTES) + aiTitleLine("from the fold") + promptLine("last prompt"));
    expect(await titleFrom(file)).toBe("from the fold");
    await settled();
    expect(sidecarsWritten()).toHaveLength(1);

    // Rewrite the TAIL in place — same length, same mtime restored — so the bytes now say something
    // else while the file still looks untouched. A reader that goes to disk answers the old title;
    // one that re-folds the transcript answers the new one.
    const full = path.join(projectDir(), file);
    const body = userLine("what I asked") + fillerLine(OVER_THRESHOLD_BYTES) + aiTitleLine("from the file") + promptLine("last prompt");
    const frozen = new Date(1_700_000_000_000);
    writeFileSync(full, body);
    const { utimesSync, statSync } = await import("node:fs");
    utimesSync(full, frozen, frozen);
    const stamped = statSync(full);

    // The sidecar was written for the ORIGINAL stamp, so make it describe this one — the point of
    // the test is the read path, not the stamp bookkeeping the sidecar spec already covers.
    const sidecar = path.join(home, ".mulmoterminal", "transcript-index", "title-fields", "-Users-me-proj", `${path.basename(file, ".jsonl")}.json`);
    const { readFileSync } = await import("node:fs");
    const parsed: unknown = JSON.parse(readFileSync(sidecar, "utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("the sidecar should be an object");
    writeFileSync(sidecar, JSON.stringify({ ...parsed, size: stamped.size, mtimeMs: stamped.mtimeMs, scannedTo: stamped.size }));

    expect(await titleFrom(file)).toBe("from the fold");
  });

  it("resumes from the sidecar's offset when the transcript has grown", async () => {
    const file = writeTranscript(userLine("what I asked") + fillerLine(OVER_THRESHOLD_BYTES) + aiTitleLine("first title") + promptLine("last prompt"));
    expect(await titleFrom(file)).toBe("first title");
    await settled();

    appendFileSync(path.join(projectDir(), file), aiTitleLine("second title"));
    expect(await titleFrom(file)).toBe("second title");
  });

  // Under the threshold a fold costs less than the file would, so there should be nothing on disk.
  it("writes no sidecar for a small transcript", async () => {
    const file = writeTranscript(userLine("u") + aiTitleLine("small"));
    expect(await titleFrom(file)).toBe("small");
    await settled();
    expect(sidecarsWritten()).toEqual([]);
  });
});
