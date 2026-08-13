// @vitest-environment node
// A config file a human edited on Windows may start with a byte-order mark: Notepad,
// `Set-Content` and PowerShell 5.1's `Out-File -Encoding utf8` all write one, and node keeps
// it as a leading U+FEFF. `JSON.parse` then throws on the first character — and every config
// reader here answers a throw with an empty config, so the file goes silently missing.
//
// The BOM is file CONTENT, so these run everywhere: the bug is reachable from any host that
// opens a file written on Windows (a repo checkout, a synced directory, a pasted config).
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripBom, readTextFile, readJsonFile } from "../../../server/infra/read-text-file";
import { loadDirConfig } from "../../../server/config/dir-config";
import { loadPresets } from "../../../server/config/cwd-presets";
import { loadScripts } from "../../../server/files/scripts";
import { loadAppConfigResult } from "../../../server/config/app-config";
import { loadUserTasks } from "../../../server/backends/scheduler";

const BOM = "﻿";
const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-bom-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("stripBom", () => {
  it("removes a LEADING byte-order mark", () => {
    expect(stripBom(`${BOM}{"a":1}`)).toBe('{"a":1}');
  });

  // A U+FEFF anywhere else is content — a zero-width no-break space inside a string value —
  // and removing it would corrupt the file rather than repair it.
  it("leaves one that is not at the start alone", () => {
    expect(stripBom(`{"a":"x${BOM}y"}`)).toBe(`{"a":"x${BOM}y"}`);
  });

  it("leaves text without one untouched, including empty text", () => {
    expect(stripBom("plain")).toBe("plain");
    expect(stripBom("")).toBe("");
  });
});

describe("readTextFile / readJsonFile", () => {
  it("reads a BOM-prefixed file as if it had none", () => {
    const dir = tmp();
    const file = path.join(dir, "x.json");
    writeFileSync(file, `${BOM}{"a":1}`, "utf8");
    expect(readTextFile(file)).toBe('{"a":1}');
    expect(readJsonFile(file)).toEqual({ a: 1 });
  });

  // The callers each decide what a corrupt file means — one answers with an empty config,
  // another refuses to overwrite it — so the parse error has to reach them.
  it("still throws on JSON that is genuinely malformed", () => {
    const dir = tmp();
    const file = path.join(dir, "x.json");
    writeFileSync(file, `${BOM}{"a":`, "utf8");
    expect(() => readJsonFile(file)).toThrow();
  });
});

// What the bug actually cost, per reader. Each of these silently produced "no config at all"
// for a file whose only sin was being saved by a Windows editor.
describe("the config readers, given a BOM", () => {
  it("keeps a directory's own chrome (.mulmoterminal.json)", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, ".mulmoterminal.json"), `${BOM}${JSON.stringify({ name: "my project", theme: "nord" })}`, "utf8");
    const config = loadDirConfig(dir);
    expect(config.name).toBe("my project");
    expect(config.theme).toBe("nord");
  });

  it("keeps the Run menu's scripts (script.json)", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "script.json"), `${BOM}${JSON.stringify({ scripts: [{ label: "build", command: "yarn build" }] })}`, "utf8");
    expect(loadScripts(dir)).toEqual([{ label: "build", command: "yarn build" }]);
  });

  it("keeps the cwd presets", () => {
    const dir = tmp();
    const file = path.join(dir, "presets.json");
    writeFileSync(file, `${BOM}${JSON.stringify({ cwdPresets: [{ label: "repo", path: "/Users/me/repo" }] })}`, "utf8");
    expect(loadPresets(file)).toEqual([{ label: "repo", path: path.resolve("/Users/me/repo") }]);
  });

  // This one had the worst failure mode: the whole app config — providers, launchers, header
  // buttons — read as "corrupt", which the lenient loader turns into an empty config.
  it("keeps the app config, rather than reading it as corrupt", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, `${BOM}${JSON.stringify({ launchers: [{ label: "shell", command: "bash" }] })}`, "utf8");
    const result = loadAppConfigResult(file);
    expect(result.status).toBe("ok");
  });

  // The user's scheduled tasks — a file they edit by hand, so the same trap, and losing it
  // means every scheduled run silently stops happening.
  it("keeps the scheduled tasks (tasks.json)", () => {
    const workspace = tmp();
    mkdirSync(path.join(workspace, "config", "scheduler"), { recursive: true });
    writeFileSync(
      path.join(workspace, "config", "scheduler", "tasks.json"),
      `${BOM}${JSON.stringify([{ id: "daily", prompt: "summarise", schedule: { kind: "daily", hour: 9, minute: 0 } }])}`,
      "utf8",
    );
    expect(loadUserTasks(workspace)).toHaveLength(1);
  });

  // A genuinely corrupt file must still be reported as corrupt: that verdict is what stops a
  // write path from overwriting a file the user is still editing.
  it("still calls a malformed app config corrupt", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, `${BOM}{"launchers":`, "utf8");
    expect(loadAppConfigResult(file).status).toBe("corrupt");
  });
});
