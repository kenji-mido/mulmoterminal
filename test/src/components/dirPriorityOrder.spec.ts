import { describe, it, expect } from "vitest";
import { UNSET_PRIORITY, dirPriority, orderByDirPriority } from "../../../src/components/dirPriorityOrder.js";

describe("dirPriority", () => {
  it("reads a directory's declared rank", () => {
    expect(dirPriority("/a", { "/a": 20 })).toBe(20);
  });

  it("ranks a directory that declares none after every directory that does", () => {
    expect(dirPriority("/b", { "/a": 20 })).toBe(UNSET_PRIORITY);
  });

  // A cell can exist without a directory (an empty launch slot), and it must not outrank a project.
  it("ranks a missing directory as unset", () => {
    expect(dirPriority(null, { "/a": 20 })).toBe(UNSET_PRIORITY);
  });

  it("honours negative ranks, so a project can sort ahead of everything at 0", () => {
    expect(dirPriority("/a", { "/a": -5 })).toBe(-5);
  });
});

describe("orderByDirPriority", () => {
  // The launcher's shape: chips carrying a path, in the stored most-recently-used order.
  const chips = (...paths: string[]) => paths.map((path) => ({ path }));
  const pathOf = (c: { path: string }) => c.path;
  const paths = (list: readonly { path: string }[]) => list.map((c) => c.path);

  it("sorts ascending by rank", () => {
    const ordered = orderByDirPriority(chips("/a", "/b", "/c"), pathOf, { "/a": 30, "/b": 10, "/c": 20 });
    expect(paths(ordered)).toEqual(["/b", "/c", "/a"]);
  });

  // The whole point of the change: ranking SOME directories must leave the rest as they were.
  it("puts unranked directories last, keeping their incoming order", () => {
    const ordered = orderByDirPriority(chips("/a", "/b", "/c", "/d"), pathOf, { "/c": 1 });
    expect(paths(ordered)).toEqual(["/c", "/a", "/b", "/d"]);
  });

  it("keeps the incoming order among equal ranks", () => {
    const ordered = orderByDirPriority(chips("/a", "/b", "/c"), pathOf, { "/a": 5, "/b": 5, "/c": 5 });
    expect(paths(ordered)).toEqual(["/a", "/b", "/c"]);
  });

  it("leaves the order untouched when nothing declares a rank", () => {
    const ordered = orderByDirPriority(chips("/a", "/b", "/c"), pathOf, {});
    expect(paths(ordered)).toEqual(["/a", "/b", "/c"]);
  });

  it("sorts a negative rank ahead of 0", () => {
    const ordered = orderByDirPriority(chips("/a", "/b", "/c"), pathOf, { "/a": 0, "/b": -5, "/c": 3 });
    expect(paths(ordered)).toEqual(["/b", "/a", "/c"]);
  });

  it("treats an item with no directory as unranked", () => {
    const items = [{ path: null }, { path: "/a" }];
    const ordered = orderByDirPriority(items, (i) => i.path, { "/a": 7 });
    expect(ordered.map((i) => i.path)).toEqual(["/a", null]);
  });

  it("returns an empty list unchanged", () => {
    expect(orderByDirPriority([], pathOf, { "/a": 1 })).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = chips("/a", "/b");
    orderByDirPriority(input, pathOf, { "/b": 1 });
    expect(paths(input)).toEqual(["/a", "/b"]);
  });
});
