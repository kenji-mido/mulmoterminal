// @vitest-environment node
// No source file may hold a control character that makes it BINARY to the ordinary tools.
//
// `server/git/issue-work.ts` held a literal NUL — meant as a key separator, written as the byte
// rather than the escape. It compiled and ran correctly, so nothing failed; what it did instead was
// make the file binary to `grep`, which skips such files SILENTLY. Several sweeps across "every
// place that calls gh" read every module except that one and reported a total that was wrong
// without saying so.
//
// Checked on the BYTES rather than with a regular expression, because a character class holding
// these characters is itself what `no-control-regex` exists to stop — and the rule is right.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// `test` is in the list because a spec is where fixtures live — pasted terminal output is
// exactly how a literal ESC gets into a file — and a spec hidden from grep is hidden just the
// same. Three of the four offenders found were specs.
const ROOTS = ["server", "src", "common", "bin", "test", "scripts"];
const SOURCE = /\.(ts|tsx|vue|js|mjs)$/;

// Tab, newline and carriage return are the only control bytes source is allowed to hold.
const ALLOWED = new Set([9, 10, 13]);
const LOWEST_PRINTABLE = 32;
const holdsBinaryByte = (file: string): boolean => readFileSync(file).some((byte) => byte < LOWEST_PRINTABLE && !ALLOWED.has(byte));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE.test(name) ? [full] : [];
  });
}

describe("source files are text", () => {
  it("holds no control byte that would make a file binary to grep", () => {
    expect(ROOTS.flatMap(sourceFiles).filter(holdsBinaryByte)).toEqual([]);
  });
});
