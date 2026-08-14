// @vitest-environment node
// Every shipped CLI entry point at least PARSES.
//
// This exists because a broken one shipped past everything else. `bin/*.js` is plain JavaScript:
// `yarn typecheck` does not cover it, no test imports it, and `yarn build` does not touch it — so
// a stray backtick inside `printHelp`'s template literal made `npx mulmoterminal` fail to start,
// with lint, typecheck, build and 8,700 tests all green (#1456).
//
// Parsing is a low bar deliberately. What it catches is the whole class of "nobody ever loaded
// this file", which is what actually happened.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin");
const scripts = readdirSync(BIN).filter((name) => name.endsWith(".js"));

describe("shipped CLI entry points", () => {
  it("has scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("%s parses", (name) => {
    // `node --check` is the parser itself — no import, so nothing runs and nothing is spawned.
    expect(() => execFileSync(process.execPath, ["--check", path.join(BIN, name)], { stdio: "pipe" })).not.toThrow();
  });
});
