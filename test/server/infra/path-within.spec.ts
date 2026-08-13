// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isSamePath, isWithin, isStrictlyWithin } from "../../../server/infra/path-within";

// Both platforms are exercised from any host: the rule differs by platform (drive
// qualification, case folding) and only one of them would ever run here otherwise.
describe("isWithin — posix", () => {
  const ROOT = "/home/u/project";

  it.each([
    ["the base itself", ROOT],
    ["a direct child", `${ROOT}/src`],
    ["a deep descendant", `${ROOT}/src/components/Cell.vue`],
    ["a path that normalizes back inside", `${ROOT}/src/../src/index.ts`],
    ["an un-normalized base spelling", `${ROOT}/./src`],
  ])("accepts %s", (_case, target) => {
    expect(isWithin(ROOT, target, "linux")).toBe(true);
  });

  it.each([
    ["a sibling", "/home/u/other"],
    // The classic prefix bug: "project-old" starts with "project" as a STRING but is not
    // inside it. This is what the trailing separator is for.
    ["a sibling whose name extends the base", "/home/u/project-old"],
    ["a parent", "/home/u"],
    ["an escape via ..", `${ROOT}/../secrets`],
  ])("rejects %s", (_case, target) => {
    expect(isWithin(ROOT, target, "linux")).toBe(false);
  });

  it("does not fold case, where the filesystem does not", () => {
    expect(isWithin(ROOT, "/home/u/Project/src", "linux")).toBe(false);
  });

  it("treats the filesystem root as containing everything, without doubling its separator", () => {
    expect(isWithin("/", "/etc/hosts", "linux")).toBe(true);
    expect(isWithin("/", "/", "linux")).toBe(true);
  });
});

describe("isWithin — win32", () => {
  const ROOT = "C:\\Users\\u\\project";

  it.each([
    ["the base itself", ROOT],
    ["a descendant", `${ROOT}\\src\\index.ts`],
    // NTFS and the Win32 API compare case-insensitively: these name ONE directory.
    ["a differently-cased base", "c:\\users\\U\\PROJECT\\src"],
    ["forward slashes, which Windows accepts", "C:/Users/u/project/src"],
    ["a trailing separator on the base", `${ROOT}\\`],
  ])("accepts %s", (_case, target) => {
    expect(isWithin(ROOT, target, "win32")).toBe(true);
  });

  it.each([
    ["a sibling whose name extends the base", "C:\\Users\\u\\project-old"],
    ["the same path on another drive", "D:\\Users\\u\\project\\src"],
    ["a parent", "C:\\Users\\u"],
  ])("rejects %s", (_case, target) => {
    expect(isWithin(ROOT, target, "win32")).toBe(false);
  });

  // The #802 failure itself: `path.resolve` drive-qualifies a rooted path, so a base left
  // unresolved ("\home\u\…") never prefixed a resolved target ("C:\home\u\…"). Resolving
  // BOTH sides is what makes a drive-less spelling work.
  it("qualifies a drive-less base the same way it qualifies the target", () => {
    expect(isWithin("\\home\\u\\worktrees", "\\home\\u\\worktrees\\repo-abc\\fix-login", "win32")).toBe(true);
  });

  it("treats a drive root as containing everything on that drive", () => {
    expect(isWithin("C:\\", "C:\\Windows\\System32", "win32")).toBe(true);
  });
});

describe("isSamePath", () => {
  it("matches the same directory spelled differently", () => {
    expect(isSamePath("/home/u/project", "/home/u/./project", "linux")).toBe(true);
    expect(isSamePath("/home/u/project", "/home/u/project/src/..", "linux")).toBe(true);
  });

  it("folds case on Windows only", () => {
    expect(isSamePath("C:\\Users\\u", "c:\\users\\U", "win32")).toBe(true);
    expect(isSamePath("/home/U", "/home/u", "linux")).toBe(false);
  });

  it("separates distinct paths", () => {
    expect(isSamePath("/home/u/a", "/home/u/b", "linux")).toBe(false);
    expect(isSamePath("C:\\a", "D:\\a", "win32")).toBe(false);
  });
});

describe("isStrictlyWithin", () => {
  it("excludes the base itself — a container is not a member of itself", () => {
    expect(isStrictlyWithin("/home/u/worktrees", "/home/u/worktrees", "linux")).toBe(false);
    expect(isStrictlyWithin("/home/u/worktrees", "/home/u/worktrees/repo-abc", "linux")).toBe(true);
  });

  it("excludes the base spelled differently, including by case on Windows", () => {
    expect(isStrictlyWithin("C:\\wt", "c:\\WT", "win32")).toBe(false);
    expect(isStrictlyWithin("/home/u/wt", "/home/u/wt/./", "linux")).toBe(false);
  });
});
