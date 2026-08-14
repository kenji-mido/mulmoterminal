import { describe, it, expect } from "vitest";
import { customAgentLaunch, tokenizeCommandLine } from "../../../server/session/custom-agent-command";

describe("tokenizeCommandLine (#1414)", () => {
  it("splits on whitespace", () => {
    expect(tokenizeCommandLine("ollama launch claude --model nemotron-3-ultra:cloud --")).toEqual([
      "ollama",
      "launch",
      "claude",
      "--model",
      "nemotron-3-ultra:cloud",
      "--",
    ]);
  });

  it("keeps a quoted argument whole", () => {
    expect(tokenizeCommandLine(`run --flag "two words" 'and more'`)).toEqual(["run", "--flag", "two words", "and more"]);
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(tokenizeCommandLine("  a\t b \n")).toEqual(["a", "b"]);
  });

  // A Windows path is the reason a backslash is literal outside quotes AND before an ordinary
  // character inside them: `C:\src` must not lose its separators to escape processing.
  it("leaves a backslash alone except where a double quote would eat the next character", () => {
    expect(tokenizeCommandLine(String.raw`C:\src\repo\claude.exe --flag`)).toEqual([String.raw`C:\src\repo\claude.exe`, "--flag"]);
    expect(tokenizeCommandLine(String.raw`"C:\Program Files\x" a`)).toEqual([String.raw`C:\Program Files\x`, "a"]);
    expect(tokenizeCommandLine(String.raw`"say \"hi\"" b`)).toEqual([`say "hi"`, "b"]);
  });

  it("has nothing to say about an empty line", () => {
    expect(tokenizeCommandLine("   ")).toEqual([]);
  });
});

describe("customAgentLaunch", () => {
  // The point of the whole feature: everything the user wrote goes IN FRONT, and Claude Code's
  // own argv is appended after it by the spawn.
  it("splits the line into the program and what precedes claude's own flags", () => {
    expect(customAgentLaunch("ollama launch claude --model nemotron-3-ultra:cloud --")).toEqual({
      file: "ollama",
      prefixArgs: ["launch", "claude", "--model", "nemotron-3-ultra:cloud", "--"],
    });
  });

  it("is a bare program with no prefix when the line is one word", () => {
    expect(customAgentLaunch("claude-wrapper")).toEqual({ file: "claude-wrapper", prefixArgs: [] });
  });

  // Unreachable through the config (a blank command is dropped in sanitizing), and the spawn
  // falls back to plain claude on it rather than starting nothing.
  it("answers null for a line with no program in it", () => {
    expect(customAgentLaunch("   ")).toBeNull();
  });
});
