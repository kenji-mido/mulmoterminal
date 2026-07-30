// Windows-only: does a chosen path survive the pipe from PowerShell back to us? (#1146)
//
// Nothing else in the suite can answer that. pick-file.spec asserts the SHAPE of the script from any
// host; the bug lives in how the child ENCODES what it prints, which only a real Windows PowerShell
// 5.1 can demonstrate. This runs in windows-daily.yaml and is skipped everywhere else.
//
// The runner is en-US (OEM code page 437), where the bug does not reproduce — so every case sets
// CP932 first to stand in for the reporter's Japanese Windows. That is the condition the fix has to
// beat: whatever the console's code page already is, the path must come back intact.
//
// The path travels in the ENVIRONMENT rather than argv or a PowerShell literal: a Windows
// environment block is UTF-16, so the child receives the exact string, and the only variable left
// under test is the encoding of its stdout.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { parsePickerOutput, pickFileCommand } from "../../../server/files/pick-file.js";
import { PS_UTF8_STDOUT } from "../../../server/files/win-powershell-utf8.js";

const isWindows = process.platform === "win32";
const PATH_VAR = "MT_PICKER_TEST_PATH";
const AS_JAPANESE_CONSOLE = "[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(932);";
const PRINT_PICKED_PATH = `$env:${PATH_VAR}`;

// One per script the bug can reach, because a code page is not a CJK problem: CP932 cannot spell
// `é` or Hangul either, and mangles the Cyrillic it does have.
const NON_ASCII_PATHS = ["C:\\proj\\日本語フォルダ", "C:\\proj\\中文目录", "C:\\proj\\한국어폴더", "C:\\proj\\café", "C:\\proj\\Кириллица"];

// The interpreter the route itself spawns, taken from the route, so this exercises the same
// resolution rather than a second guess at where PowerShell lives.
const { cmd: POWERSHELL } = pickFileCommand("win32", true);

function powershellStdout(script: string, picked: string): Buffer {
  const result = spawnSync(POWERSHELL, ["-NoProfile", "-Command", script], { env: { ...process.env, [PATH_VAR]: picked } });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

// Exactly how the route reads the picker: decode as UTF-8, then parse the lines.
const pickedPaths = (stdout: Buffer): string[] => parsePickerOutput(stdout.toString());

describe.skipIf(!isWindows)("a Windows picker's stdout", () => {
  it.each(NON_ASCII_PATHS)("comes back byte-for-byte from a CP932 console: %s", (picked) => {
    expect(pickedPaths(powershellStdout(`${AS_JAPANESE_CONSOLE} ${PS_UTF8_STDOUT}; ${PRINT_PICKED_PATH}`, picked))).toEqual([picked]);
  });

  // The control. Without the prelude the path IS mangled here — which is what proves the case above
  // tests the fix rather than an en-US runner's harmless default.
  it("is mangled without the prelude, so the case above is a real guard", () => {
    const picked = NON_ASCII_PATHS[0];
    const [decoded] = pickedPaths(powershellStdout(`${AS_JAPANESE_CONSOLE} ${PRINT_PICKED_PATH}`, picked));
    expect(decoded).not.toBe(picked);
    expect(decoded?.startsWith("C:\\proj\\")).toBe(true); // ...and absolute-looking, hence the silent fallback
  });

  // A BOM-carrying encoding would prefix the first line with EF BB BF. `parsePickerOutput` survives
  // that, but only via `trim`, so keep the bytes clean at the source too.
  it("carries no BOM", () => {
    const stdout = powershellStdout(`${PS_UTF8_STDOUT}; ${PRINT_PICKED_PATH}`, NON_ASCII_PATHS[0]);
    expect([...stdout.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});
