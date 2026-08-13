// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome.js";
import { isRecord } from "../../../common/isRecord.js";

// A sidecar answers for a file it is not part of, and it can be days old when it is read — so what
// matters is every reason to DISTRUST it. Each check below is a case where answering from disk
// would be wrong rather than merely slow (#1386).

let scratch: ScratchHome;
let home = "";
let projects = "";

// MULMOTERMINAL_HOME is read at import time, so the module is imported per test run against a
// scratch home rather than the developer's own.
async function loadSidecar() {
  vi.resetModules(); // the scratch home is already in place; the module reads it at import
  const mod = await import("../../../server/session/transcript-sidecar.js");
  return mod.createTranscriptSidecar;
}

interface Fields {
  title: string;
}
const isFields = (v: unknown): v is Fields => isRecord(v) && typeof v.title === "string";

const BIG = 10 * 1024 * 1024;
// Big enough to be worth a sidecar (the default threshold), with a first record that identifies it.
const transcriptBody = (session: string, filler = BIG) => `${JSON.stringify({ type: "session", session })}\n${"x".repeat(filler)}\n`;

function writeTranscript(session: string, body?: string): string {
  const dir = path.join(projects, "-Users-me-proj");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.jsonl`);
  writeFileSync(file, body ?? transcriptBody(session));
  return file;
}

const stampOf = (file: string) => {
  const st = statSync(file);
  return { mtimeMs: st.mtimeMs, size: st.size };
};

const sidecarFile = (kind: string, transcript: string) =>
  path.join(home, ".mulmoterminal", "transcript-index", kind, path.basename(path.dirname(transcript)), `${path.basename(transcript, ".jsonl")}.json`);

// The write is fire-and-forget, so a test that reads the file back has to let it land.
const settled = async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 5));
};

beforeEach(() => {
  scratch = takeScratchHome("mt-sidecar-home-");
  home = scratch.path;
  projects = path.join(home, ".claude", "projects");
  mkdirSync(projects, { recursive: true });
});
afterEach(() => scratch.release());

describe("createTranscriptSidecar", () => {
  it("reads back what it wrote, and resumes at the stored offset", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    const stamp = stampOf(file);

    expect(await sidecar.read(file, stamp)).toBeUndefined(); // nothing written yet
    sidecar.write(file, stamp, 1234, { title: "hello" });
    await settled();

    expect(await sidecar.read(file, stamp)).toEqual({ from: 1234, value: { title: "hello" } });
  });

  it("resumes at the stored offset for a file that only grew", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    sidecar.write(file, stampOf(file), 100, { title: "hello" });
    await settled();

    appendFileSync(file, "more\n");
    expect(await sidecar.read(file, stampOf(file))).toEqual({ from: 100, value: { title: "hello" } });
  });

  // Each of these means the value describes a file that is no longer the one on disk.
  it("refuses a stale record rather than answering from it", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    const stamp = stampOf(file);
    sidecar.write(file, stamp, 100, { title: "hello" });
    await settled();
    const onDisk = sidecarFile("k", file);
    const parsed: unknown = JSON.parse(readFileSync(onDisk, "utf8"));
    if (!isRecord(parsed)) throw new Error("the sidecar should be an object");
    const rewrite = (patch: Record<string, unknown>) => writeFileSync(onDisk, JSON.stringify({ ...parsed, ...patch }));

    rewrite({ v: 2 }); // written by a build whose fold meant something else
    expect(await sidecar.read(file, stamp)).toBeUndefined();

    rewrite({ size: stamp.size + 10 }); // the file got SHORTER than the record
    expect(await sidecar.read(file, stamp)).toBeUndefined();

    rewrite({ mtimeMs: stamp.mtimeMs + 1 }); // same length, written again
    expect(await sidecar.read(file, stamp)).toBeUndefined();

    rewrite({ scannedTo: stamp.size + 1 }); // claims to have read past the end
    expect(await sidecar.read(file, stamp)).toBeUndefined();

    rewrite({ value: { title: 42 } }); // not the shape the guard accepts
    expect(await sidecar.read(file, stamp)).toBeUndefined();

    writeFileSync(onDisk, "{not json");
    expect(await sidecar.read(file, stamp)).toBeUndefined();
  });

  // A number that cannot be a file offset is not a smaller answer, it is a THROW: createReadStream
  // rejects a negative or fractional `start`, and the session list turns that into a row that
  // silently disappears — from a record it will keep reading (CodeRabbit).
  it("refuses an offset that could not be a position in a file", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    const stamp = stampOf(file);
    sidecar.write(file, stamp, 100, { title: "hello" });
    await settled();
    const onDisk = sidecarFile("k", file);
    const parsed: unknown = JSON.parse(readFileSync(onDisk, "utf8"));
    if (!isRecord(parsed)) throw new Error("the sidecar should be an object");
    const rewrite = (patch: Record<string, unknown>) => writeFileSync(onDisk, JSON.stringify({ ...parsed, ...patch }));

    for (const scannedTo of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      rewrite({ scannedTo });
      expect(await sidecar.read(file, stamp)).toBeUndefined();
    }
    rewrite({ size: -1 });
    expect(await sidecar.read(file, stamp)).toBeUndefined();
    rewrite({ mtimeMs: Number.NaN });
    expect(await sidecar.read(file, stamp)).toBeUndefined();
  });

  // (mtime, size) cannot tell "appended to" from "replaced by something longer", and a sidecar can
  // be days old when it is read — so the first bytes are checked too.
  it("refuses a file whose head changed under a record that still looks fresh", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    sidecar.write(file, stampOf(file), 100, { title: "hello" });
    await settled();

    // A different session's transcript, longer than the one the record describes.
    writeFileSync(file, transcriptBody("b", BIG + 500));
    expect(await sidecar.read(file, stampOf(file))).toBeUndefined();
  });

  // A small transcript folds in under a millisecond; a file for it would cost more than it saves.
  it("neither writes nor reads for a file under the threshold", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("small", `${JSON.stringify({ type: "session" })}\n`);
    const stamp = stampOf(file);
    sidecar.write(file, stamp, 10, { title: "hello" });
    await settled();

    expect(existsSync(path.join(home, ".mulmoterminal", "transcript-index"))).toBe(false);
    expect(await sidecar.read(file, stamp)).toBeUndefined();
  });

  // Eight mulmoterminals share this directory. A reader must never see half a file, and a writer
  // must not leave its scratch file behind.
  it("leaves no temporary file behind, and the last of several writers wins", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    const stamp = stampOf(file);

    sidecar.write(file, stamp, 1, { title: "one" });
    sidecar.write(file, stamp, 2, { title: "two" });
    sidecar.write(file, stamp, 3, { title: "three" });
    await settled();

    expect(await sidecar.read(file, stamp)).toEqual({ from: 3, value: { title: "three" } });
    const dir = path.dirname(sidecarFile("k", file));
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  // Two kinds of derived value for the same transcript are two files, not one overwriting the other.
  it("keeps one file per kind", async () => {
    const create = await loadSidecar();
    const titles = create<Fields>({ kind: "titles", version: 1, isValue: isFields });
    const costs = create<Fields>({ kind: "costs", version: 1, isValue: isFields });
    const file = writeTranscript("a");
    const stamp = stampOf(file);

    titles.write(file, stamp, 1, { title: "a title" });
    costs.write(file, stamp, 2, { title: "a cost" });
    await settled();

    expect(await titles.read(file, stamp)).toEqual({ from: 1, value: { title: "a title" } });
    expect(await costs.read(file, stamp)).toEqual({ from: 2, value: { title: "a cost" } });
  });

  // The path is built from BASENAMES, so a transcript path cannot place a file outside the root.
  it("keeps the file inside the sidecar root whatever the transcript path looks like", async () => {
    const create = await loadSidecar();
    const sidecar = create<Fields>({ kind: "k", version: 1, isValue: isFields });
    const dir = path.join(projects, "..", "..", "escape-attempt");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "s.jsonl");
    writeFileSync(file, transcriptBody("s"));

    sidecar.write(file, stampOf(file), 1, { title: "x" });
    await settled();
    const written = readdirSync(path.join(home, ".mulmoterminal", "transcript-index"), { recursive: true }).map(String);
    expect(written.some((e) => e.endsWith("s.json"))).toBe(true);
    expect(written.every((e) => !e.includes(".."))).toBe(true);
  });
});
