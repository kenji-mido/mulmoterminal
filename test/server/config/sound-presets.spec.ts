// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readSoundPreset } from "../../../server/config/sound-presets";
import { makeTempDir } from "../../support/tempDir";

const cacheDir = () => makeTempDir("mt-sounds-");
const audio = (text: string) => new Response(new TextEncoder().encode(text), { status: 200 });

describe("readSoundPreset", () => {
  it("downloads once, then serves every later read from disk", async () => {
    const dir = cacheDir();
    const fetchImpl = vi.fn().mockResolvedValue(audio("coin-bytes"));
    const first = await readSoundPreset("coin", { cacheDir: dir, fetchImpl });
    expect(first?.toString()).toBe("coin-bytes");
    expect(existsSync(path.join(dir, "sound_coin.mp3"))).toBe(true);

    const second = await readSoundPreset("coin", { cacheDir: dir, fetchImpl });
    expect(second?.toString()).toBe("coin-bytes");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the point: offline from here on
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a pre-existing cache file without any network call", async () => {
    const dir = cacheDir();
    writeFileSync(path.join(dir, "sound_gong.mp3"), "already-here");
    const fetchImpl = vi.fn();
    expect((await readSoundPreset("gong", { cacheDir: dir, fetchImpl }))?.toString()).toBe("already-here");
    expect(fetchImpl).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers null for an unknown id, without touching the network", async () => {
    const fetchImpl = vi.fn();
    expect(await readSoundPreset("nope", { cacheDir: cacheDir(), fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // A failure must not be remembered as one: a machine that was offline for one beep has to
  // get its sound on the next, so nothing is written and the next call retries.
  it("does not cache a failed download, and retries next time", async () => {
    const dir = cacheDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 404 }))
      .mockResolvedValueOnce(audio("late-bytes"));
    expect(await readSoundPreset("meow", { cacheDir: dir, fetchImpl })).toBeNull();
    expect(existsSync(path.join(dir, "sound_meow.mp3"))).toBe(false);
    expect((await readSoundPreset("meow", { cacheDir: dir, fetchImpl }))?.toString()).toBe("late-bytes");
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives a fetch that throws (offline)", async () => {
    const dir = cacheDir();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    expect(await readSoundPreset("magic", { cacheDir: dir, fetchImpl })).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an empty or oversized body rather than caching it", async () => {
    const dir = cacheDir();
    const empty = vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 200 }));
    expect(await readSoundPreset("cheep", { cacheDir: dir, fetchImpl: empty })).toBeNull();

    const huge = vi.fn().mockResolvedValue(new Response(new Uint8Array(3 * 1024 * 1024), { status: 200 }));
    expect(await readSoundPreset("door", { cacheDir: dir, fetchImpl: huge })).toBeNull();
    expect(existsSync(path.join(dir, "sound_door_chime.mp3"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  // The stat and the read live inside ONE try. Splitting them (an existsSync guard, then a
  // stat outside the try) lets a cache entry that is not a regular file — or that vanishes
  // between the two calls — throw out of here, and the route answers 500 instead of quietly
  // re-downloading. A directory at the cache path is the reachable half of that.
  it("re-downloads when the cache path is not a regular file", async () => {
    const dir = cacheDir();
    mkdirSync(path.join(dir, "sound_coin.mp3"));
    const fetchImpl = vi.fn().mockResolvedValue(audio("fresh"));
    expect((await readSoundPreset("coin", { cacheDir: dir, fetchImpl }))?.toString()).toBe("fresh");
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives an unstattable cache path rather than throwing", async () => {
    // cacheDir under a FILE: every stat below it fails with ENOTDIR.
    const dir = cacheDir();
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const fetchImpl = vi.fn().mockResolvedValue(audio("fresh"));
    await expect(readSoundPreset("coin", { cacheDir: path.join(blocker, "sounds"), fetchImpl })).resolves.not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shares one download between concurrent callers", async () => {
    const dir = cacheDir();
    const fetchImpl = vi.fn().mockResolvedValue(audio("shared"));
    const [a, b, c] = await Promise.all([
      readSoundPreset("chime", { cacheDir: dir, fetchImpl }),
      readSoundPreset("chime", { cacheDir: dir, fetchImpl }),
      readSoundPreset("chime", { cacheDir: dir, fetchImpl }),
    ]);
    expect([a?.toString(), b?.toString(), c?.toString()]).toEqual(["shared", "shared", "shared"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readFileSync(path.join(dir, "sound_default.mp3")).toString()).toBe("shared");
    rmSync(dir, { recursive: true, force: true });
  });
});
