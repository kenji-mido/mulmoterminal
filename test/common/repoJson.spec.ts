// @vitest-environment node
// Normalising `repo.json`'s shape (#1442). The specification gives two fields a scalar shorthand,
// under one rule — "where a field has an obvious primary value, the scalar form is shorthand for
// the fullest form" — and normalising at the boundary is what makes that rule cost one function
// instead of a branch at every use.
import { describe, it, expect } from "vitest";
import { parseRepoJson, rankIcons, EMPTY_REPO_META } from "../../common/repoJson";

const parse = (raw: unknown) => parseRepoJson(raw, "mulmoterminal");

describe("the shorthand forms", () => {
  it("expands an icon string to the array form", () => {
    expect(parse({ icon: "logo.svg" }).icons).toEqual([{ src: "logo.svg" }]);
  });

  it("expands a colour string to primary", () => {
    expect(parse({ color: "#7c3aed" }).colors).toEqual({ primary: "#7c3aed", accent: null, background: null });
  });

  // The equivalence the spec states: the two forms must produce the same normalised value, or an
  // implementation ends up with two behaviours for one setting.
  it("gives the string and the fullest form the same result", () => {
    expect(parse({ icon: "logo.svg" }).icons).toEqual(parse({ icon: [{ src: "logo.svg" }] }).icons);
    expect(parse({ color: "#7c3aed" }).colors).toEqual(parse({ color: { primary: "#7c3aed" } }).colors);
  });
});

describe("icon ranking", () => {
  // A vector is exact at any size, so `any` outranks every pixel count.
  it("puts a vector first", () => {
    const icons = parse({
      icon: [
        { src: "big.png", sizes: "512x512" },
        { src: "vector.svg", sizes: "any" },
      ],
    }).icons;
    expect(icons[0].src).toBe("vector.svg");
  });

  it("then the largest declared size", () => {
    const icons = parse({
      icon: [
        { src: "small.png", sizes: "48x48" },
        { src: "big.png", sizes: "512x512" },
        { src: "mid.png", sizes: "192x192" },
      ],
    }).icons;
    expect(icons.map((i) => i.src)).toEqual(["big.png", "mid.png", "small.png"]);
  });

  // "The first listed wins a tie" is asserted as a property of the ranking, not left to whether
  // the engine's sort happens to be stable.
  it("keeps the author's order on a tie", () => {
    const icons = rankIcons([{ src: "a.png", sizes: "64x64" }, { src: "b.png", sizes: "64x64" }, { src: "c.png" }]);
    expect(icons.map((i) => i.src)).toEqual(["a.png", "b.png", "c.png"]);
  });

  // Still an icon — just an unranked one. Dropping it would lose a repository's only mark.
  it("keeps an entry that declares no size, sorted last", () => {
    const icons = parse({ icon: [{ src: "unsized.png" }, { src: "sized.png", sizes: "64x64" }] }).icons;
    expect(icons.map((i) => i.src)).toEqual(["sized.png", "unsized.png"]);
  });

  it("drops entries with no usable src, and survives junk", () => {
    expect(parse({ icon: [null, 42, {}, { src: "" }, { src: "ok.png" }] }).icons).toEqual([{ src: "ok.png" }]);
    expect(parse({ icon: 42 }).icons).toEqual([]);
  });
});

describe("extensions", () => {
  it("picks up this consumer's entry and ignores the others", () => {
    const meta = parse({ extensions: { mulmoterminal: { theme: "midnight" }, other: { x: 1 } } });
    expect(meta.extension).toEqual({ theme: "midnight" });
  });

  it("is null when the file has none, or when it isn't an object", () => {
    expect(parse({}).extension).toBeNull();
    expect(parse({ extensions: { mulmoterminal: "nope" } }).extension).toBeNull();
    expect(parse({ extensions: "nope" }).extension).toBeNull();
  });
});

describe("tolerance", () => {
  // Every field optional, and an empty object valid — a conformance rule, not a nicety.
  it("reads an empty object as nothing set", () => {
    expect(parse({})).toEqual(EMPTY_REPO_META);
  });

  it("reads a non-object as nothing set", () => {
    [null, undefined, 42, "x", []].forEach((raw) => expect(parse(raw)).toEqual(EMPTY_REPO_META));
  });

  it("trims, and treats a blank string as absent", () => {
    expect(parse({ name: "  proj  " }).name).toBe("proj");
    expect(parse({ name: "   " }).name).toBeNull();
  });
});
