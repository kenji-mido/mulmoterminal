import { describe, it, expect } from "vitest";
import { dirPathKey, isSameDirPath } from "../../common/dirPathKey";

// Raised by Codex on #1208: the launcher compared a path the user typed against one git reported
// with `===`, so `/wt/foo/` and `/repo/../wt/foo` read as different directories and the control
// that should have been greyed out stayed live.
describe("dirPathKey", () => {
  it("folds a trailing slash", () => {
    expect(dirPathKey("/wt/foo/")).toBe(dirPathKey("/wt/foo"));
    expect(dirPathKey("/wt/foo///")).toBe(dirPathKey("/wt/foo"));
  });

  it("folds dot segments", () => {
    expect(dirPathKey("/wt/./foo")).toBe("/wt/foo");
    expect(dirPathKey("/repo/../wt/foo")).toBe("/wt/foo");
    expect(dirPathKey("/wt/foo/bar/..")).toBe("/wt/foo");
  });

  it("folds repeated separators", () => {
    expect(dirPathKey("/wt//foo")).toBe("/wt/foo");
  });

  // The same app runs on Windows, and the field takes whichever separator the user pasted.
  it("folds both separators, and keeps a drive root", () => {
    expect(dirPathKey("C:\\wt\\foo\\")).toBe("C:/wt/foo");
    expect(isSameDirPath("C:\\wt\\foo", "C:/wt/foo")).toBe(true);
  });

  // Raised by CodeRabbit: `C:foo` is relative to the current directory ON drive C, not `C:\foo`,
  // and `\server\share` is drive-relative rather than the UNC `\\server\share`. Folding either
  // pair together would let one directory grey out a control belonging to another.
  it("keeps a drive-relative path apart from a rooted one", () => {
    expect(isSameDirPath("C:foo", "C:/foo")).toBe(false);
    expect(dirPathKey("C:foo")).toBe("C:foo");
  });

  it("keeps a UNC share apart from a drive-relative path of the same name", () => {
    expect(isSameDirPath("\\\\server\\share", "\\server\\share")).toBe(false);
    expect(dirPathKey("\\\\server\\share\\")).toBe("//server/share");
    expect(isSameDirPath("\\\\server\\share\\wt\\.", "//server/share/wt")).toBe(true);
  });

  // `..` past the root has nowhere to go. Letting it eat the root would turn an absolute path into
  // a relative one, which could then match a different directory entirely.
  it("cannot climb above a root", () => {
    expect(dirPathKey("/../../wt")).toBe("/wt");
    expect(dirPathKey("/..")).toBe("/");
  });

  it("keeps a relative path relative, leading `..` and all", () => {
    expect(dirPathKey("../wt/foo")).toBe("../wt/foo");
    expect(dirPathKey("../../a/../b")).toBe("../../b");
  });

  it("distinguishes directories that really are different", () => {
    expect(isSameDirPath("/wt/foo", "/wt/foobar")).toBe(false);
    expect(isSameDirPath("/wt/foo", "/wt/foo/bar")).toBe(false);
  });

  it("treats an absent path as matching nothing, including another absent one", () => {
    expect(isSameDirPath(null, null)).toBe(false);
    expect(isSameDirPath("/wt/foo", undefined)).toBe(false);
    expect(isSameDirPath("  ", "")).toBe(false);
  });
});
