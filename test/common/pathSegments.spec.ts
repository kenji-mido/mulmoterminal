// @vitest-environment node
//
// One separator is not enough. These paths come from a config file and from a saved directory
// list, so a Windows path can be read on a mac and a POSIX one on Windows — and code that splits
// on "/" alone does not fail loudly on `C:\Users\me\project`, it returns the WHOLE STRING as one
// segment. That is how a "label" becomes an absolute path, which is exactly what the phone's
// project listing promises never to send.
import { describe, it, expect } from "vitest";
import { pathSegments, lastSegment } from "../../common/pathSegments";

describe("pathSegments", () => {
  it("splits a POSIX path", () => {
    expect(pathSegments("/Users/me/git/ai/mag2")).toEqual(["Users", "me", "git", "ai", "mag2"]);
  });

  it("splits a WINDOWS path — the case a '/' split silently passes through whole", () => {
    expect(pathSegments("C:\\Users\\me\\project")).toEqual(["C:", "Users", "me", "project"]);
    expect(pathSegments("\\\\server\\share\\project")).toEqual(["server", "share", "project"]);
  });

  it("splits a mixed path, which a synced config really does contain", () => {
    expect(pathSegments("C:/Users\\me/project")).toEqual(["C:", "Users", "me", "project"]);
  });

  it("drops empty parts rather than emitting them", () => {
    expect(pathSegments("//a///b//")).toEqual(["a", "b"]);
    expect(pathSegments("")).toEqual([]);
  });
});

describe("lastSegment", () => {
  it("names the directory, on either platform's spelling", () => {
    expect(lastSegment("/Users/me/mag2")).toBe("mag2");
    expect(lastSegment("C:\\src\\mag2")).toBe("mag2");
    expect(lastSegment("/Users/me/mag2/")).toBe("mag2");
  });

  it("falls back to the input when there is nothing to take", () => {
    expect(lastSegment("")).toBe("");
    expect(lastSegment("/")).toBe("/");
  });
});
