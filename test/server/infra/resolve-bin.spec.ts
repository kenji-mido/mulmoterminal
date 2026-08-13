// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveWindowsExecutable, resolveWindowsBatch, resolvePtyLaunch } from "../../../server/infra/resolve-bin";

// A fake Windows filesystem: the exact set of files that exist, matched case-insensitively
// the way Windows does.
const filesystem = (...files: string[]) => {
  const present = new Set(files.map((file) => file.toLowerCase()));
  return (candidate: string) => present.has(candidate.toLowerCase());
};

const LOCAL_BIN = "C:\\Users\\u\\.local\\bin";
const SYSTEM32 = "C:\\Windows\\System32";
const NPM_BIN = "C:\\Users\\u\\AppData\\Roaming\\npm";
const COMSPEC = `${SYSTEM32}\\cmd.exe`;

describe("resolveWindowsExecutable", () => {
  it("finds the .exe a bare name refers to (the #794 case: no extensionless shim exists)", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN};C:\\tools`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("searches the LAST PATH entry — node-pty's own splitter never pushes the segment after the final ';'", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN}`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("takes the first PATH directory that has it", () => {
    const exists = filesystem(`${SYSTEM32}\\tmux.exe`, `${LOCAL_BIN}\\tmux.exe`);
    expect(resolveWindowsExecutable("tmux", `${SYSTEM32};${LOCAL_BIN}`, exists)).toBe(`${SYSTEM32}\\tmux.exe`);
  });

  it("prefers .exe over .com in the same directory, since a bare name would have reached the .exe", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.com`, `${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("finds a .com when that is the only candidate", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.com`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBe(`${LOCAL_BIN}\\claude.com`);
  });

  // CreateProcessW — which node-pty calls right after the lookup this feeds — runs PE images
  // only. Naming a shim directly breaks a spawn that works today, where the shim merely
  // satisfies node-pty's existence gate and CreateProcess finds the real .exe further down PATH.
  it("ignores an extensionless shim and keeps looking for a real executable (the codex case)", () => {
    const exists = filesystem(`${LOCAL_BIN}\\codex`, `${SYSTEM32}\\codex.exe`);
    expect(resolveWindowsExecutable("codex", `${LOCAL_BIN};${SYSTEM32}`, exists)).toBe(`${SYSTEM32}\\codex.exe`);
  });

  it("ignores .cmd / .bat / .ps1 — CreateProcess cannot execute them", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.cmd`, `${LOCAL_BIN}\\claude.bat`, `${LOCAL_BIN}\\claude.ps1`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBeNull();
  });

  it("matches a name that already carries .exe exactly, without appending another extension", () => {
    const exists = filesystem(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("powershell.exe", SYSTEM32, exists)).toBe(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("powershell.exe", SYSTEM32, filesystem(`${SYSTEM32}\\powershell.exe.exe`))).toBeNull();
  });

  it("matches the given extension case-insensitively", () => {
    const exists = filesystem(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("PowerShell.EXE", SYSTEM32, exists)).toBe(`${SYSTEM32}\\PowerShell.EXE`);
  });

  it("leaves a name that already names a path alone — node-pty resolves those itself", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable(`${LOCAL_BIN}\\claude.exe`, LOCAL_BIN, exists)).toBeNull();
    expect(resolveWindowsExecutable("bin\\claude", LOCAL_BIN, exists)).toBeNull();
    expect(resolveWindowsExecutable("./claude", LOCAL_BIN, exists)).toBeNull();
  });

  it("returns null for an empty name, an empty PATH, and a missing PATH", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("", `${LOCAL_BIN}`, exists)).toBeNull();
    expect(resolveWindowsExecutable("claude", "", exists)).toBeNull();
    expect(resolveWindowsExecutable("claude", undefined, exists)).toBeNull();
  });

  it("skips empty PATH entries rather than resolving against the cwd", () => {
    const seen: string[] = [];
    const exists = (candidate: string) => {
      seen.push(candidate);
      return candidate === `${LOCAL_BIN}\\claude.exe`;
    };
    expect(resolveWindowsExecutable("claude", `;;${LOCAL_BIN};`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
    expect(seen).toEqual([`${LOCAL_BIN}\\claude.exe`]);
  });

  it("unquotes a PATH entry, the way a shell does", () => {
    const programFiles = "C:\\Program Files\\tools";
    const exists = filesystem(`${programFiles}\\tmux.exe`);
    expect(resolveWindowsExecutable("tmux", `"${programFiles}"`, exists)).toBe(`${programFiles}\\tmux.exe`);
  });

  it("returns null when nothing on PATH matches", () => {
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN}`, filesystem(`${SYSTEM32}\\codex.exe`))).toBeNull();
  });
});

describe("resolveWindowsBatch", () => {
  it("finds the .cmd an npm-global install leaves on PATH", () => {
    const exists = filesystem(`${NPM_BIN}\\claude`, `${NPM_BIN}\\claude.cmd`, `${NPM_BIN}\\claude.ps1`);
    expect(resolveWindowsBatch("claude", NPM_BIN, exists)).toBe(`${NPM_BIN}\\claude.cmd`);
  });

  it("finds a .bat too, and prefers .cmd when both are there", () => {
    expect(resolveWindowsBatch("tool", NPM_BIN, filesystem(`${NPM_BIN}\\tool.bat`))).toBe(`${NPM_BIN}\\tool.bat`);
    expect(resolveWindowsBatch("tool", NPM_BIN, filesystem(`${NPM_BIN}\\tool.bat`, `${NPM_BIN}\\tool.cmd`))).toBe(`${NPM_BIN}\\tool.cmd`);
  });

  it("ignores an extensionless shim — cmd.exe cannot run one either", () => {
    expect(resolveWindowsBatch("claude", NPM_BIN, filesystem(`${NPM_BIN}\\claude`))).toBeNull();
  });
});

describe("resolvePtyLaunch", () => {
  const ARGS = ["--resume", "abc"];

  // Off Windows this must be inert, not merely equivalent: node-pty resolves bare names
  // correctly there, so the name goes through untouched, the SAME argv array is handed on,
  // and the filesystem is never consulted (no probe runs at all).
  it.each(["darwin", "linux"] as const)("touches nothing on %s — same name, same argv array, no filesystem probe", (platform) => {
    let probes = 0;
    const countingProbe = () => {
      probes++;
      return true;
    };
    const launch = resolvePtyLaunch("claude", ARGS, platform, "/usr/local/bin", "/bin/sh", countingProbe);
    expect(launch.file).toBe("claude");
    expect(launch.args).toBe(ARGS);
    expect(probes).toBe(0);
  });

  it("names the .exe and leaves the arguments as an argv array (#794, unchanged)", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolvePtyLaunch("claude", ARGS, "win32", LOCAL_BIN, COMSPEC, exists)).toEqual({ file: `${LOCAL_BIN}\\claude.exe`, args: ARGS });
  });

  it("runs a .cmd through cmd.exe as one raw command line", () => {
    const exists = filesystem(`${NPM_BIN}\\claude.cmd`, COMSPEC);
    expect(resolvePtyLaunch("claude", ARGS, "win32", NPM_BIN, COMSPEC, exists)).toEqual({
      file: COMSPEC,
      args: `/d /s /c ""${NPM_BIN}\\claude.cmd" "--resume" "abc""`,
    });
  });

  // The reporter's codex install in #794: an extensionless shim (and a .cmd) in an EARLIER
  // PATH directory than the codex.exe that actually runs today. cmd.exe's own per-directory
  // order would move it onto the batch path; a spawn that works must not gain a layer.
  it("prefers an .exe anywhere on PATH over a .cmd in an earlier directory", () => {
    const exists = filesystem(`${NPM_BIN}\\codex`, `${NPM_BIN}\\codex.cmd`, `${LOCAL_BIN}\\codex.exe`);
    expect(resolvePtyLaunch("codex", [], "win32", `${NPM_BIN};${LOCAL_BIN}`, COMSPEC, exists)).toEqual({ file: `${LOCAL_BIN}\\codex.exe`, args: [] });
  });

  // `CLAUDE_BIN=C:\…\claude.cmd` is what someone sets to work around a broken spawn, and it
  // skips the PATH search entirely — but CreateProcess still cannot run a batch file.
  it("wraps an explicit .cmd/.bat path, absolute or relative", () => {
    const explicit = `${NPM_BIN}\\claude.cmd`;
    expect(resolvePtyLaunch(explicit, ARGS, "win32", NPM_BIN, COMSPEC, filesystem(COMSPEC))).toEqual({
      file: COMSPEC,
      args: `/d /s /c ""${explicit}" "--resume" "abc""`,
    });
    const relative = ".\\claude.bat";
    expect(resolvePtyLaunch(relative, [], "win32", NPM_BIN, COMSPEC, filesystem(COMSPEC))).toEqual({
      file: COMSPEC,
      args: `/d /s /c ""${relative}""`,
    });
  });

  it("leaves an explicit .exe path alone — node-pty and CreateProcess both handle it", () => {
    const explicit = `${LOCAL_BIN}\\claude.exe`;
    expect(resolvePtyLaunch(explicit, ARGS, "win32", LOCAL_BIN, COMSPEC, filesystem(explicit))).toEqual({ file: explicit, args: ARGS });
    expect(resolvePtyLaunch("/bin/bash", ARGS, "win32", LOCAL_BIN, COMSPEC, filesystem())).toEqual({ file: "/bin/bash", args: ARGS });
  });

  it("keeps the bare name on Windows when nothing resolves, so a host that works today still works", () => {
    expect(resolvePtyLaunch("claude", ARGS, "win32", "C:\\nowhere", COMSPEC, filesystem())).toEqual({ file: "claude", args: ARGS });
  });

  it("falls back to a PATH lookup for the command processor when ComSpec is unusable", () => {
    const exists = filesystem(`${NPM_BIN}\\claude.cmd`, `${SYSTEM32}\\cmd.exe`);
    const launch = resolvePtyLaunch("claude", [], "win32", `${NPM_BIN};${SYSTEM32}`, "C:\\gone\\cmd.exe", exists);
    expect(launch.file).toBe(`${SYSTEM32}\\cmd.exe`);
  });

  it("still names cmd.exe when neither ComSpec nor PATH can place it", () => {
    const launch = resolvePtyLaunch("claude", [], "win32", NPM_BIN, undefined, filesystem(`${NPM_BIN}\\claude.cmd`));
    expect(launch.file).toBe("cmd.exe");
  });
});
