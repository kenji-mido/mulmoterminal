// The durable "I hid this session" choice (remote/mobile work). What these tests defend is the
// difference between hiding and deleting: a hidden session must stay RESUMABLE — the transcript
// is never touched — and the hide must still be there after a restart, or the row the user
// dismissed comes back on the next boot.
//
// The store reads ~/.mulmoterminal/hidden-sessions.json at import, so `node:os` is mocked to a
// temp home. Without that these tests would read — and rewrite — the file the running server is
// using.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const { HOME } = vi.hoisted(() => ({ HOME: `/tmp/mt-hidden-store-${crypto.randomUUID()}` }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual.default, homedir: () => HOME }, homedir: () => HOME };
});

// Per-call delays for the atomic writer, so the "which write lands last" race can be reproduced
// deterministically instead of hoped for. Empty (the default) means no delay and the REAL writer
// — every other test here still exercises the actual temp-and-rename.
const writes = vi.hoisted(() => ({ delaysMs: [] as number[], count: 0 }));

vi.mock("../../../server/files/atomic-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/files/atomic-write.js")>();
  return {
    ...actual,
    writeFileAtomic: async (file: string, data: string) => {
      const delay = writes.delaysMs[writes.count++] ?? 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return actual.writeFileAtomic(file, data);
    },
  };
});

const STORE = path.join(HOME, ".mulmoterminal", "hidden-sessions.json");
const A = "01234567-89ab-cdef-0123-456789abcdef";
const B = "fedcba98-7654-3210-fedc-ba9876543210";

// A fresh import re-runs the module's load() — this is what "survives a restart" means here.
async function freshStore() {
  vi.resetModules();
  return await import("../../../server/session/hidden-store.js");
}

const writeStore = async (contents: string) => {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, contents);
};

describe("hidden-store", () => {
  beforeEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
    writes.delaysMs = [];
    writes.count = 0;
  });
  afterEach(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
  });

  it("reports nothing hidden before anything is hidden", async () => {
    const { isUserHidden } = await freshStore();
    expect(isUserHidden(A)).toBe(false);
  });

  it("hides an id and persists it", async () => {
    const { hideSessionId, isUserHidden } = await freshStore();
    hideSessionId(A);
    expect(isUserHidden(A)).toBe(true);
    // The write is async and best-effort; give the atomic rename a tick to land.
    await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(STORE, "utf8"))).toEqual([A]));
  });

  // The regression that matters: a hide the user made yesterday must not reappear as a row today.
  it("a hide survives a restart", async () => {
    const first = await freshStore();
    first.hideSessionId(A);
    await vi.waitFor(async () => expect(await fs.readFile(STORE, "utf8")).toContain(A));

    const restarted = await freshStore();
    expect(restarted.isUserHidden(A)).toBe(true);
    expect(restarted.isUserHidden(B)).toBe(false);
  });

  it("keeps every hidden id, not just the last one", async () => {
    const { hideSessionId, isUserHidden } = await freshStore();
    hideSessionId(A);
    await vi.waitFor(async () => expect(await fs.readFile(STORE, "utf8")).toContain(A));
    hideSessionId(B);
    await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(STORE, "utf8")).sort()).toEqual([A, B].sort()));
    expect([isUserHidden(A), isUserHidden(B)]).toEqual([true, true]);
  });

  // Two hides in the same tick put two writes in flight, each carrying the set as of its OWN
  // call: the first says [A], the second says [A,B]. Unchained they race, and when the slower
  // [A] lands last it silently drops the second hide — the row the user dismissed is back on the
  // next boot, with nothing on screen to say so.
  //
  // The first write is made deliberately slow so that "the older snapshot lands last" is what
  // happens every run, not what happens under load once in five. Without the persist chain in
  // hidden-store.ts this test fails every time; with it, the second write cannot start until the
  // first has finished, so the newest snapshot is always the one on disk.
  it("does not lose a hide made while the previous write is still in flight", async () => {
    writes.delaysMs = [40, 0]; // the [A] write is slow; the [A,B] write is instant
    const { hideSessionId } = await freshStore();
    hideSessionId(A);
    hideSessionId(B); // no await between them — deliberately racing the first save

    await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(STORE, "utf8")).sort()).toEqual([A, B].sort()), { timeout: 2000 });
    const restarted = await freshStore();
    expect([restarted.isUserHidden(A), restarted.isUserHidden(B)]).toEqual([true, true]);
  });

  it("hiding the same id twice is a no-op, not a duplicate row", async () => {
    const { hideSessionId } = await freshStore();
    hideSessionId(A);
    hideSessionId(A);
    await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(STORE, "utf8"))).toEqual([A]));
  });

  it("treats a corrupt store as nothing hidden rather than failing to boot", async () => {
    await writeStore("{not json");
    const { isUserHidden } = await freshStore();
    expect(isUserHidden(A)).toBe(false);
  });

  it("ignores non-string entries a hand-edited file might carry", async () => {
    await writeStore(JSON.stringify([A, 42, null, { id: B }]));
    const { isUserHidden } = await freshStore();
    expect(isUserHidden(A)).toBe(true);
    expect(isUserHidden(B)).toBe(false);
  });

  it("treats a JSON object (not an array) as nothing hidden", async () => {
    await writeStore(JSON.stringify({ hidden: [A] }));
    const { isUserHidden } = await freshStore();
    expect(isUserHidden(A)).toBe(false);
  });
});
