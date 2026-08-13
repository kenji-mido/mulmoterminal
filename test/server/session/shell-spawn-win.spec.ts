// @vitest-environment node
// Windows-only: the terminal paths that run a SHELL rather than an agent — the Run menu's
// one-off command and a configured launcher. Both compose shellInvocation() with spawnPty(),
// and on Windows that means `powershell.exe -NoLogo -Command <command>`.
//
// Neither had ever executed on Windows in CI: shell-command.spec asserts the argv shape from
// any host, and nothing spawned it. That matters because PowerShell is a second parser
// between us and the command — the same class of problem as #813, where a quoted payload
// survived cmd.exe and was then dropped by the receiving program. A command carrying quotes
// or a shell metacharacter is the case to watch, so those are the cases here.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";
import { spawnPty } from "../../../server/session/pty-spawn";
import { shellInvocation } from "../../../server/session/shell-command";

const isWindows = process.platform === "win32";

// A conpty wraps at the window width and paints escape sequences, so compare on the visible
// text with the sequences and line breaks taken out.
const plainText = (data: string): string =>
  data
    // eslint-disable-next-line no-control-regex -- reading a terminal's own output back
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/[\r\n]/g, "");

function runShell(command: string, cwd: string, replaceShell = false): Promise<{ output: string; exitCode: number }> {
  const { shell, args } = shellInvocation(command, replaceShell, "win32", undefined);
  const term: IPty = spawnPty(shell, args, cwd);
  let output = "";
  term.onData((data) => {
    output += data;
  });
  return new Promise((resolve) => term.onExit(({ exitCode }) => resolve({ output: plainText(output), exitCode })));
}

describe.skipIf(!isWindows)("a shell terminal on Windows", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-shell-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs a command and streams its output", async () => {
    const { output, exitCode } = await runShell("Write-Output MTOK-plain", dir);
    expect(output).toContain("MTOK-plain");
    expect(exitCode).toBe(0);
  });

  // The command reaches PowerShell as ONE argv element (`-Command <command>`), so nothing in
  // it may be re-split. A space is the cheapest way to say that.
  it("keeps a multi-word command in one piece", async () => {
    const { output } = await runShell("Write-Output 'MTOK two words'", dir);
    expect(output).toContain("MTOK two words");
  });

  // #813's class, on the PowerShell path: a payload carrying double quotes has to arrive
  // whole. The reporter there measured PowerShell mangling exactly this shape when it was
  // typed at an interactive prompt — this asserts the programmatic path does not.
  it("carries a quoted JSON payload through without losing its quotes", async () => {
    const { output } = await runShell(`Write-Output '{"a":1,"b":"x y"}'`, dir);
    expect(output).toContain('{"a":1,"b":"x y"}');
  });

  // A metacharacter inside the command belongs to PowerShell, not to whatever spawned it.
  it("does not let a shell metacharacter escape the command", async () => {
    const { output } = await runShell("Write-Output 'a&b|c>d'", dir);
    expect(output).toContain("a&b|c>d");
  });

  // Awkward content on the PowerShell side. Single-quoted in PowerShell so the shell itself
  // treats the payload as literal — what is being checked is that the string survives the
  // hop from us to PowerShell intact, not PowerShell's own quoting rules.
  it.each([
    ["double quotes", '{"a":1}'],
    ["parens and brackets", "(a) [b] {c}"],
    ["ampersand and pipe", "a&b|c"],
    ["semicolon and comma", "a;b,c"],
    ["caret and percent", "a^b%c%"],
    ["bang", "a!b"],
    ["CJK", "日本語のテキスト"],
    ["emoji", "emoji 📎 ok"],
    ["accents", "café naïve"],
  ])("carries %s through to the command", async (_case, payload) => {
    const { output } = await runShell(`Write-Output '${payload}'`, dir);
    expect(output).toContain(payload);
  });

  // A backtick is PowerShell's escape character, but ONLY inside double quotes — the
  // assumption this case started life asserting, and the Windows runner corrected it. In
  // single quotes it is literal like everything else, so a Run command wrapped that way means
  // what it looks like; wrapped in double quotes it does not, and both are worth recording
  // because a Run command is user text.
  it("treats a backtick literally inside single quotes", async () => {
    const { output } = await runShell("Write-Output 'a`nb'", dir);
    expect(output).toContain("a`nb");
  });

  it("lets PowerShell consume the backtick inside double quotes", async () => {
    const { output } = await runShell('Write-Output "x`ty"', dir);
    expect(output).not.toContain("`");
  });

  it("reports a failing command's exit code", async () => {
    const { exitCode } = await runShell("exit 3", dir);
    expect(exitCode).toBe(3);
  });

  // A launcher is the persistent variant. On Windows it is the same invocation — `exec` is
  // POSIX-only — so what this pins is that the win32 arm ignores replaceShell rather than
  // producing something PowerShell cannot run.
  it("runs a launcher command the same way", async () => {
    const { output, exitCode } = await runShell("Write-Output MTOK-launcher", dir, true);
    expect(output).toContain("MTOK-launcher");
    expect(exitCode).toBe(0);
  });

  it("runs in the directory it was given", async () => {
    const { output } = await runShell("Write-Output (Get-Location).Path", dir);
    // The conpty may wrap a long path, so compare on the leaf.
    expect(output).toContain(path.basename(dir));
  });
});
