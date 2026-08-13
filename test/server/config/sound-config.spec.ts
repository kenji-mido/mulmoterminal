// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { sanitizeSoundKinds, sanitizeSounds, sanitizeSoundValue } from "../../../server/config/app-config.js";

// Absolute is the only property under test, and resolve() gives one on every platform without
// naming a real (or publicly writable) directory.
const ABS = path.resolve("sounds/beep.mp3");

describe("sanitizeSoundKinds", () => {
  it("keeps only kinds that exist, in the canonical order", () => {
    expect(sanitizeSoundKinds(["waiting", "nope", 7, null, "finished"])).toEqual(["finished", "waiting"]);
    expect(sanitizeSoundKinds(["pr-ci-failed", "command-done"])).toEqual(["command-done", "pr-ci-failed"]);
  });

  it("de-duplicates", () => {
    expect(sanitizeSoundKinds(["waiting", "waiting", "finished"])).toEqual(["finished", "waiting"]);
  });

  // Missing means "never chose", which for an upgrading user has to keep the beeps they
  // already had — going silent on upgrade is the failure mode this defends.
  it("falls back to the defaults for a non-array", () => {
    for (const bad of [undefined, null, "finished", { finished: true }, 7]) {
      expect(sanitizeSoundKinds(bad)).toEqual(["finished", "waiting"]);
    }
  });

  it("keeps an explicit empty list — that is the user saying 'none'", () => {
    expect(sanitizeSoundKinds([])).toEqual([]);
  });

  it("returns a fresh array each call, so a caller cannot mutate the defaults", () => {
    const first = sanitizeSoundKinds(undefined);
    first.push("pr-ci-failed");
    expect(sanitizeSoundKinds(undefined)).toEqual(["finished", "waiting"]);
  });
});

describe("sanitizeSoundValue", () => {
  it("accepts a known preset reference", () => {
    expect(sanitizeSoundValue("preset:coin")).toBe("preset:coin");
    expect(sanitizeSoundValue("  preset:gong  ")).toBe("preset:gong");
  });

  it("rejects a preset that does not exist", () => {
    expect(sanitizeSoundValue("preset:nope")).toBeNull();
  });

  it("accepts an absolute path and rejects a relative one", () => {
    expect(sanitizeSoundValue(ABS)).toBe(ABS);
    expect(sanitizeSoundValue("sounds/beep.mp3")).toBeNull();
    expect(sanitizeSoundValue("")).toBeNull();
    expect(sanitizeSoundValue(42)).toBeNull();
  });
});

describe("sanitizeSounds", () => {
  it("keeps known kinds and drops the rest", () => {
    expect(sanitizeSounds({ finished: "preset:coin", nope: "preset:gong", waiting: ABS })).toEqual({
      finished: "preset:coin",
      waiting: ABS,
    });
  });

  // One typo'd kind must cost the user that entry only — dropping the whole map would silently
  // reset every sound they had set.
  it("drops only the bad entry", () => {
    expect(sanitizeSounds({ finished: "preset:coin", waiting: "relative/path.mp3" })).toEqual({ finished: "preset:coin" });
  });

  it("answers a non-object with an empty map", () => {
    for (const bad of [undefined, null, "preset:coin", 7, ["preset:coin"]]) {
      expect(sanitizeSounds(bad)).toEqual({});
    }
  });
});
