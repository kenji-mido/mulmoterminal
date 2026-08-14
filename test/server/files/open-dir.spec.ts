// @vitest-environment node
import { describe, it, expect } from "vitest";
import { openDirCommands } from "../../../server/files/open-dir.js";

describe("openDirCommands", () => {
  it("uses `open` on macOS", () => {
    expect(openDirCommands("darwin", false)).toEqual([{ cmd: "open" }]);
  });
  it("uses `explorer` on Windows", () => {
    expect(openDirCommands("win32", false)).toEqual([{ cmd: "explorer" }]);
  });
  it("falls back to `xdg-open` elsewhere (Linux)", () => {
    expect(openDirCommands("linux", false)).toEqual([{ cmd: "xdg-open" }]);
  });
  // WSL has no Linux file manager to reveal anything in, so the folder belongs to Windows
  // Explorer — which needs the path in its own form (#1447).
  it("uses Windows Explorer, and a Windows path, on WSL", () => {
    expect(openDirCommands("linux", true)[0]).toEqual({ cmd: "explorer.exe", windowsPath: true });
  });
  // Detection is a guess (a kernel name, or environment variables a service may not have), so a
  // wrong one must cost an ENOENT and a retry — never the feature.
  it("still tries xdg-open after Explorer, so a wrong WSL guess degrades", () => {
    expect(openDirCommands("linux", true).map((c) => c.cmd)).toEqual(["explorer.exe", "xdg-open"]);
  });
});
