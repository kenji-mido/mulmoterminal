// @vitest-environment node
import { describe, it, expect } from "vitest";
import { batchCommandLine, escapeBatchArgument, UnsafeArgumentError } from "../../../server/infra/cmd-escape";

const CLAUDE_CMD = "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd";

describe("escapeBatchArgument", () => {
  it("quotes even an argument that needs nothing, so cmd cannot re-split it", () => {
    expect(escapeBatchArgument("--resume")).toBe('"--resume"');
  });

  it("keeps whitespace inside one argument", () => {
    expect(escapeBatchArgument("fix the login bug")).toBe('"fix the login bug"');
    expect(escapeBatchArgument("a\tb")).toBe('"a\tb"');
  });

  // The injection this whole module exists to stop: unquoted, cmd would read `&` as a
  // command separator and run the rest as its own command.
  it.each(["&", "|", "<", ">", "^", "(", ")", "&&", "||", "&calc"])("neutralises the cmd metacharacter %s by quoting", (meta) => {
    expect(escapeBatchArgument(`prompt${meta}`)).toBe(`"prompt${meta}"`);
  });

  // cmd's escape is a doubled quote. The CRT's `\"` — what node-pty's argsToCommandLine
  // emits — would END the quoted run here, leaving the rest of the argument as cmd input.
  it("doubles an internal quote rather than backslash-escaping it", () => {
    expect(escapeBatchArgument('say "hi"')).toBe('"say ""hi"""');
    expect(escapeBatchArgument('"')).toBe('""""');
  });

  it("escapes the JSON payloads we actually pass (--settings, --mcp-config)", () => {
    const json = '{"hooks":{"Stop":[{"command":"curl -s http://127.0.0.1:34567/api/hook"}]}}';
    expect(escapeBatchArgument(json)).toBe(`"${json.replace(/"/g, '""')}"`);
  });

  // Without this, the CRT reading the same text sees `\"` — an escaped quote — and swallows
  // the argument boundary: `C:\dir\` would run on into the next argument.
  it("doubles a trailing backslash run so it cannot escape the closing quote", () => {
    expect(escapeBatchArgument("C:\\dir\\")).toBe('"C:\\dir\\\\"');
    expect(escapeBatchArgument("C:\\dir\\\\")).toBe('"C:\\dir\\\\\\\\"');
  });

  it("leaves backslashes that are not at the end alone", () => {
    expect(escapeBatchArgument("C:\\dir\\file.txt")).toBe('"C:\\dir\\file.txt"');
  });

  it("keeps an empty argument as an argument", () => {
    expect(escapeBatchArgument("")).toBe('""');
  });

  it("passes non-ASCII through unchanged", () => {
    expect(escapeBatchArgument("ログインの不具合")).toBe('"ログインの不具合"');
  });

  // Known limitation, deliberately not "fixed": cmd expands %VAR% inside double quotes and
  // `^` cannot prevent it. Rejecting every argument with a percent sign would break ordinary
  // prompts ("50% done"), and substituting our own child's env into its own argument is a
  // correctness wart, not a privilege boundary. Recorded so the next reader knows it was a
  // decision.
  it("does NOT prevent %VAR% expansion — cmd has no escape for it inside quotes", () => {
    expect(escapeBatchArgument("%PATH%")).toBe('"%PATH%"');
  });

  it.each([
    ["NUL", "a\0b"],
    ["CR", "a\rb"],
    ["LF", "a\nb"],
  ])("rejects an argument containing %s rather than mangling it", (_name, arg) => {
    expect(() => escapeBatchArgument(arg)).toThrow(UnsafeArgumentError);
  });
});

describe("batchCommandLine", () => {
  it("builds `/d /s /c` with the shim and its arguments inside one outer quote pair", () => {
    expect(batchCommandLine(CLAUDE_CMD, ["--resume", "abc"])).toBe(`/d /s /c ""${CLAUDE_CMD}" "--resume" "abc""`);
  });

  it("runs the shim with no arguments at all", () => {
    expect(batchCommandLine(CLAUDE_CMD, [])).toBe(`/d /s /c ""${CLAUDE_CMD}""`);
  });

  it("starts with /d, so a registry AutoRun command cannot run inside the session first", () => {
    expect(batchCommandLine(CLAUDE_CMD, [])).toMatch(/^\/d /);
  });

  it("propagates the rejection instead of emitting a truncated command line", () => {
    expect(() => batchCommandLine(CLAUDE_CMD, ["ok", "bad\nline"])).toThrow(UnsafeArgumentError);
  });
});
