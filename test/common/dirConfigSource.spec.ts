import { describe, it, expect } from "vitest";
import { describeDirConfig, keysWithValue, DIR_CONFIG_KEYS } from "../../common/dirConfigSource";

describe("keysWithValue", () => {
  it("keeps the keys that hold something", () => {
    expect([...keysWithValue({ name: "proj", fontSize: 14, orderPriority: 0 })].sort()).toEqual(["fontSize", "name", "orderPriority"]);
  });

  // The loader answers "nothing survived" with null for a scalar but with an EMPTY collection
  // for the map/list fields — both mean the same thing to a reader of the preview.
  it("treats null, an empty object and an empty list alike as nothing", () => {
    expect([...keysWithValue({ name: null, sounds: {}, buttons: [], theme: "dark" })]).toEqual(["theme"]);
  });

  it("keeps a value that is falsy but real", () => {
    expect([...keysWithValue({ orderPriority: 0 })]).toEqual(["orderPriority"]);
  });
});

describe("describeDirConfig", () => {
  it("splits the file's keys into applied, dropped and unrecognised", () => {
    const raw = { name: "proj", headerColor: "not-a-colour", badgeColour: "#123456" };
    expect(describeDirConfig(raw, new Set(["name"]))).toEqual({
      applied: ["name"],
      ignored: ["headerColor"], // known key, but the loader kept nothing
      unknown: ["badgeColour"], // British spelling — the app never reads it
      // Filled in by dirConfigDetail, which knows which of the two files each key came from;
      // this function is only handed the merged object (#1430).
      local: [],
      repo: [],
    });
  });

  it("reports nothing for a file that sets nothing", () => {
    expect(describeDirConfig({}, new Set())).toEqual({ applied: [], ignored: [], unknown: [], local: [], repo: [] });
  });

  // A key the loader resolved but the FILE didn't set must not be reported as applied — the
  // preview is about this file, not about everything the app ended up with.
  it("only reports keys the file actually set", () => {
    expect(describeDirConfig({ name: "proj" }, new Set(["name", "theme", "fontSize"]))).toEqual({
      applied: ["name"],
      ignored: [],
      unknown: [],
      local: [],
      repo: [],
    });
  });

  it("counts every documented key as known", () => {
    const raw = Object.fromEntries(DIR_CONFIG_KEYS.map((key) => [key, "x"]));
    expect(describeDirConfig(raw, new Set()).unknown).toEqual([]);
  });
});
