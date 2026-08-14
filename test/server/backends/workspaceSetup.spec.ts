// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { isManagedWorkspace, initWorkspaceSetup, refreshCodexSkillsMirror } from "../../../server/backends/workspaceSetup.js";

// Save/restore MULMOCLAUDE_WORKSPACE_PATH so a test can mark a temp dir as the
// managed workspace without leaking into sibling tests. CODEX_HOME likewise, so the
// mirror-refresh tests never touch the real ~/.codex.
const ENV_KEY = "MULMOCLAUDE_WORKSPACE_PATH";
const CODEX_ENV_KEY = "CODEX_HOME";
let savedEnv: string | undefined;
let savedCodexEnv: string | undefined;
let codexHome: string;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-setup-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  savedCodexEnv = process.env[CODEX_ENV_KEY];
  Reflect.deleteProperty(process.env, ENV_KEY);
  codexHome = makeTempDir();
  process.env[CODEX_ENV_KEY] = codexHome;
});

afterEach(() => {
  if (savedEnv === undefined) Reflect.deleteProperty(process.env, ENV_KEY);
  else process.env[ENV_KEY] = savedEnv;
  if (savedCodexEnv === undefined) Reflect.deleteProperty(process.env, CODEX_ENV_KEY);
  else process.env[CODEX_ENV_KEY] = savedCodexEnv;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isManagedWorkspace", () => {
  it("treats ~/mulmoclaude as managed by default", () => {
    expect(isManagedWorkspace(path.join(homedir(), "mulmoclaude"))).toBe(true);
  });

  it("treats an arbitrary project dir as not managed", () => {
    expect(isManagedWorkspace(makeTempDir())).toBe(false);
  });

  // The workspace arrives from the launcher's --cwd, so its casing is the user's. The question is
  // whether that spelling names the managed directory, and the answer is the FILESYSTEM's, not
  // the platform's: macOS is POSIX and case-insensitive by default, so there `MULMOCLAUDE` is the
  // same directory and seeding into it is correct rather than a spill.
  //
  // Measured on the SAME directory it asserts about, and one that EXISTS. An earlier version
  // probed a temp dir and asserted about `~/MULMOCLAUDE`: two different volumes on a CI runner,
  // where the home directory also has no managed workspace at all — and a path whose leaf does
  // not exist keeps the casing it was written with, so the probe and the assertion disagreed.
  it("compares by the filesystem's own casing rule", () => {
    const dir = makeTempDir();
    process.env[ENV_KEY] = dir;
    const shouted = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
    const caseInsensitive = ((): boolean => {
      try {
        return realpathSync.native(shouted) === realpathSync.native(dir);
      } catch {
        return false;
      }
    })();
    expect(isManagedWorkspace(shouted)).toBe(process.platform === "win32" || caseInsensitive);
  });

  it("honors MULMOCLAUDE_WORKSPACE_PATH (resolved compare)", () => {
    const dir = makeTempDir();
    process.env[ENV_KEY] = dir;
    expect(isManagedWorkspace(dir)).toBe(true);
    // A trailing-segment variant resolves to the same path.
    expect(isManagedWorkspace(path.join(dir, "sub", ".."))).toBe(true);
    expect(isManagedWorkspace(makeTempDir())).toBe(false);
  });
});

describe("initWorkspaceSetup", () => {
  it("seeds helps + preset-skills catalog into a managed workspace", () => {
    const workspace = makeTempDir();
    process.env[ENV_KEY] = workspace;

    initWorkspaceSetup({ workspace });

    // Help docs land under config/helps.
    expect(existsSync(path.join(workspace, "config", "helps", "index.md"))).toBe(true);
    // Preset skills land in the catalog half (UI-visible, not Claude-visible).
    const presetDir = path.join(workspace, "data", "skills", "catalog", "preset");
    expect(existsSync(path.join(presetDir, "mc-library", "SKILL.md"))).toBe(true);
    expect(readdirSync(presetDir).every((slug) => slug.startsWith("mc-"))).toBe(true);
  });

  it("writes nothing into a non-managed workspace", () => {
    const workspace = makeTempDir();
    // No MULMOCLAUDE_WORKSPACE_PATH → an arbitrary dir is not managed.

    initWorkspaceSetup({ workspace });

    expect(existsSync(path.join(workspace, "config"))).toBe(false);
    expect(existsSync(path.join(workspace, "data"))).toBe(false);
    expect(existsSync(path.join(workspace, ".claude"))).toBe(false);
    expect(readdirSync(workspace)).toHaveLength(0);
  });
});

describe("refreshCodexSkillsMirror", () => {
  const addSkill = (workspace: string, name: string): void => {
    const dir = path.join(workspace, ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
  };

  // The point of the refresh: a skill created AFTER boot reaches codex on the next spawn,
  // not the next server restart.
  it("mirrors a skill created after boot into the codex root", () => {
    const workspace = makeTempDir();
    process.env[ENV_KEY] = workspace;
    addSkill(workspace, "made-later");

    refreshCodexSkillsMirror(workspace);

    expect(existsSync(path.join(codexHome, "skills", "made-later", "SKILL.md"))).toBe(true);
  });

  // An arbitrary project's skills must not land in the user-global codex root, where they
  // would fire in every other directory's sessions too.
  it("does nothing outside the managed workspace", () => {
    const workspace = makeTempDir();
    addSkill(workspace, "project-local");

    refreshCodexSkillsMirror(workspace);

    expect(existsSync(path.join(codexHome, "skills"))).toBe(false);
  });
});
