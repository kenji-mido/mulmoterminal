// @vitest-environment node
import { describe, it, expect } from "vitest";
import { byCodeUnit } from "../../common/byCodeUnit.js";

describe("byCodeUnit", () => {
  it("orders zero-padded date directories chronologically", () => {
    expect(["2026", "2025", "2024"].sort(byCodeUnit)).toEqual(["2024", "2025", "2026"]);
    expect(["10", "02", "01"].sort(byCodeUnit)).toEqual(["01", "02", "10"]);
  });

  it("orders ISO-stamped rollout filenames chronologically", () => {
    const names = ["rollout-2026-08-02T09-00-00-b.jsonl", "rollout-2026-08-02T08-00-00-a.jsonl"];
    expect(names.sort(byCodeUnit)[0]).toBe("rollout-2026-08-02T08-00-00-a.jsonl");
  });

  // The point of not using localeCompare: the answer must not depend on who is running the app.
  // "a" vs "B" is where the two disagree — code units put uppercase first, most locales do not.
  it("is locale-independent where localeCompare is not", () => {
    expect(byCodeUnit("B", "a")).toBeLessThan(0);
    expect(["a", "B"].sort(byCodeUnit)).toEqual(["B", "a"]);
  });

  it("reports equality as 0 and is symmetric", () => {
    expect(byCodeUnit("x", "x")).toBe(0);
    expect(Math.sign(byCodeUnit("a", "b"))).toBe(-Math.sign(byCodeUnit("b", "a")));
  });
});
