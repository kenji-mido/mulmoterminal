// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";

import { parseEslintJson, renderReport } from "../../scripts/lint-summary.mjs";

const result = (filePath: string, ruleId = "max-lines", severity = 2) => ({
  filePath,
  messages: [{ ruleId, severity }],
});

describe("parseEslintJson", () => {
  // eslint exits non-zero with an EMPTY stdout when it dies before linting (an
  // unreadable config, a plugin that will not load). Reading that as "no findings"
  // made `yarn lint:summary` print a clean report and exit 0 for a lint that never
  // ran — and the pipeline reports this process's status, not eslint's.
  it("rejects empty output rather than reading it as a clean run", () => {
    expect(() => parseEslintJson("")).toThrow(/wrote no output/);
    expect(() => parseEslintJson("   \n ")).toThrow(/wrote no output/);
  });

  it("accepts the literal `[]` a clean run emits", () => {
    expect(parseEslintJson("[]")).toEqual([]);
  });

  it("names the input when it is not eslint json", () => {
    expect(() => parseEslintJson("Oops! Something went wrong")).toThrow(/not eslint --format json/);
  });
});

describe("renderReport areas", () => {
  const cwd = path.sep === "\\" ? "C:\\repo" : "/repo";
  const under = (...parts: string[]) => [cwd, ...parts].join(path.sep);

  // The helpers split on "/", so a path still carrying the platform separator is
  // one segment and lands in `other`. This repo lints on Windows daily, where
  // `relative` answers `server\session\x.ts`.
  it("classifies by area using the platform's own separator", () => {
    const report = renderReport([result(under("server", "session", "x.ts"))], cwd);
    expect(report).toContain('"server" : 1');
    expect(report).not.toContain('"other"');
  });

  it("groups a directory three levels deep with forward slashes", () => {
    const report = renderReport([result(under("test", "src", "components", "x.spec.ts"))], cwd);
    expect(report).toContain("test/src/components");
  });

  it("puts a root-level file in `other`", () => {
    const report = renderReport([result(under("vite.config.ts"))], cwd);
    expect(report).toContain('"other" : 1');
  });

  it("counts errors and warnings separately", () => {
    const report = renderReport([result(under("src", "a.ts"), "r", 2), result(under("src", "b.ts"), "r", 1)], cwd);
    expect(report).toContain("2 (1 error, 1 warning)");
  });

  it("says so when there is nothing to report", () => {
    expect(renderReport([], cwd)).toContain("Nothing reported.");
  });
});
