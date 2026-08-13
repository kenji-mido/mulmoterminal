// The /api/repo-dirs response is parsed rather than trusted: every path in it can become the
// working directory a session is started in, so a malformed entry has to offer NO clone rather
// than a wrong one.
import { describe, it, expect } from "vitest";
import { parseRepoDirsResponse } from "../../common/repoDirs";

const candidate = (path: string, orderPriority: number | null = null) => ({ path, label: path.split("/").pop(), orderPriority });

describe("parseRepoDirsResponse", () => {
  it("reads a well-formed answer through unchanged", () => {
    const parsed = parseRepoDirsResponse({ repos: [{ repo: "acme/web", dirs: [candidate("/w/web", 20)], primary: "/w/web" }] });
    expect(parsed).toEqual([{ repo: "acme/web", dirs: [{ path: "/w/web", label: "web", orderPriority: 20 }], primary: "/w/web" }]);
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["an object with no repos", {}],
    ["repos that is not an array", { repos: {} }],
  ])("is empty for %s", (_case, data) => {
    expect(parseRepoDirsResponse(data)).toEqual([]);
  });

  it.each([
    ["a repo with no name", { repo: "", dirs: [candidate("/w/a")] }],
    ["a repo whose name is not a string", { repo: 5, dirs: [candidate("/w/a")] }],
    ["a repo with no dirs array", { repo: "acme/web", primary: "/w/a" }],
  ])("drops %s", (_case, entry) => {
    expect(parseRepoDirsResponse({ repos: [entry] })).toEqual([]);
  });

  it("drops a candidate with no usable path but keeps its siblings", () => {
    const parsed = parseRepoDirsResponse({
      repos: [{ repo: "acme/web", dirs: [{ path: "", label: "x", orderPriority: null }, { path: 5 }, candidate("/w/web")], primary: null }],
    });
    expect(parsed[0].dirs.map((d) => d.path)).toEqual(["/w/web"]);
  });

  // The dangerous one: a primary the candidate list does not contain would start work in a
  // directory this side never offered and cannot show.
  it.each([
    ["a primary naming no candidate", { repo: "acme/web", dirs: [candidate("/w/web")], primary: "/w/elsewhere" }],
    ["a primary that is not a string", { repo: "acme/web", dirs: [candidate("/w/web")], primary: 5 }],
  ])("refuses %s", (_case, entry) => {
    expect(parseRepoDirsResponse({ repos: [entry] })[0].primary).toBeNull();
  });
});
