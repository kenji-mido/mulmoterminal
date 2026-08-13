// @vitest-environment node
// `writeFileSync` truncates the destination and then writes into it, so a crash — or a full
// disk — in between leaves a half-written file. For the app config that means every provider,
// launcher and header button read as corrupt on the next boot, i.e. as no configuration at
// all. The repo already had the async answer to this; this is the same guarantee for a caller
// that cannot await.
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "../../../server/files/atomic-write";
import { saveAppConfig, loadAppConfigResult } from "../../../server/config/app-config";

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-atomic-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("writeFileAtomicSync", () => {
  it("writes the content, creating the parent directory", () => {
    const file = path.join(tmp(), "nested", "deeper", "config.json");
    writeFileAtomicSync(file, '{"a":1}');
    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it("replaces an existing file", () => {
    const file = path.join(tmp(), "config.json");
    writeFileAtomicSync(file, "first");
    writeFileAtomicSync(file, "second");
    expect(readFileSync(file, "utf8")).toBe("second");
  });

  // The temp is what makes the write atomic; leaving one behind on every save would litter
  // the config directory with them.
  it("leaves no temp file behind", () => {
    const dir = tmp();
    writeFileAtomicSync(path.join(dir, "config.json"), "x");
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  // The property itself, which cannot be seen from outside: the destination is never opened
  // for writing. A plain writeFileSync truncates it first, and the difference only shows if
  // the process dies in between — so the calls are asserted directly.
  it("writes somewhere else first and renames onto the destination", () => {
    const file = path.join(tmp(), "config.json");
    const calls: string[] = [];
    writeFileAtomicSync(
      file,
      "x",
      (target) => calls.push(`write ${target}`),
      (from, to) => calls.push(`rename ${from} -> ${to}`),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toBe(`write ${file}`); // never the destination
    expect(calls[0].startsWith(`write ${file}.`)).toBe(true); // a temp beside it
    expect(calls[1].endsWith(`-> ${file}`)).toBe(true); // and only then, one rename
  });

  it("does not leave its temp behind when the rename is what failed", () => {
    const dir = tmp();
    // Renaming onto a DIRECTORY fails on every platform — the error class a Windows lock
    // produces, reachable from here.
    const blocked = path.join(dir, "occupied");
    writeFileAtomicSync(path.join(blocked, "keep.txt"), "x"); // makes `occupied` a directory
    expect(() => writeFileAtomicSync(blocked, "y")).toThrow();
    expect(readdirSync(dir)).toEqual(["occupied"]);
  });
});

describe("saveAppConfig", () => {
  // What the atomicity is for: the previous config has to still be there when a save fails,
  // rather than a truncated file that the next boot reads as corrupt.
  it("round-trips through the real loader", () => {
    const file = path.join(tmp(), "config.json");
    expect(saveAppConfig(file, { launchers: [{ label: "shell", command: "bash" }] } as never, {})).toBe(true);
    const loaded = loadAppConfigResult(file);
    expect(loaded.status).toBe("ok");
  });

  it("reports failure instead of destroying what is there", () => {
    const dir = tmp();
    // A path whose parent is a file: the write cannot succeed, and must not be reported as if
    // it had.
    const file = path.join(dir, "config.json");
    saveAppConfig(file, {} as never, {});
    const impossible = path.join(file, "child.json");
    expect(saveAppConfig(impossible, {} as never, {})).toBe(false);
    expect(existsSync(file)).toBe(true); // the real config is untouched
  });
});
