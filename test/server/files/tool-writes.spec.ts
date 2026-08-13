// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { writtenFilePath } from "../../../server/files/tool-writes";
import { dirConfigWriteTarget } from "../../../server/config/dir-config";

describe("writtenFilePath", () => {
  it("reports the file a write tool wrote", () => {
    expect(writtenFilePath("Write", { file_path: "/proj/a.md" })).toBe(path.resolve("/proj/a.md"));
    expect(writtenFilePath("Edit", { file_path: "/proj/a.md" })).toBe(path.resolve("/proj/a.md"));
    expect(writtenFilePath("MultiEdit", { file_path: "/proj/a.md" })).toBe(path.resolve("/proj/a.md"));
  });

  it("ignores tools that do not write a file", () => {
    expect(writtenFilePath("Bash", { command: "rm -rf /" })).toBeNull();
    expect(writtenFilePath("Read", { file_path: "/proj/a.md" })).toBeNull();
    expect(writtenFilePath("Write", { pattern: "*.md" })).toBeNull();
  });

  // A relative path belongs to the SESSION's cwd. Resolving it against the server process's
  // would name a file nobody is looking at and miss the real one.
  it("resolves a relative path against the session's cwd, and reports nothing without one", () => {
    expect(writtenFilePath("Write", { file_path: "docs/a.md" }, "/proj")).toBe(path.resolve("/proj/docs/a.md"));
    expect(writtenFilePath("Write", { file_path: "docs/a.md" })).toBeNull();
  });
});

// The config's live reload and the editor's change feed read the same hook; stating one in
// terms of the other is what stops them drifting apart.
describe("dirConfigWriteTarget still narrows to the config file", () => {
  it("answers the directory for .mulmoterminal.json and nothing for other files", () => {
    expect(dirConfigWriteTarget("Write", { file_path: "/proj/.mulmoterminal.json" })).toBe(path.resolve("/proj"));
    expect(dirConfigWriteTarget("Write", { file_path: "/proj/README.md" })).toBeNull();
  });

  it("resolves a relative config path against the session's cwd", () => {
    expect(dirConfigWriteTarget("Write", { file_path: ".mulmoterminal.json" }, "/proj")).toBe(path.resolve("/proj"));
  });
});
