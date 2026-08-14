// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { tmpdir } from "node:os";

import {
  cleanupSessionSettings,
  settingsArgument,
  mcpConfigArgument,
  withSettingsCleanup,
  pruneOrphanSettings,
  appendedPromptArgument,
} from "../../../server/session/session-settings.js";
import { resolvePtyLaunch } from "../../../server/infra/resolve-bin.js";
import { hookSettingsJson } from "../../../server/session/hook-settings.js";
import { buildClaudeArgs } from "../../../server/agents/claude-args.js";
import { appendedSystemPrompt } from "../../../server/agents/appended-prompt.js";

const SESSION = "settings-spec-session";
const fileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}.json`);
const mcpFileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}-mcp.json`);
const promptFileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}-prompt.txt`);

afterEach(() => cleanupSessionSettings(SESSION));

describe("settingsArgument", () => {
  // A settings payload with no secret in it keeps travelling inline, so every existing
  // session's spawn is untouched by this feature. The platform is named rather than
  // inherited: Windows has its own reason to use a file (#813, below), so left implicit
  // this would assert the opposite of the truth on the Windows runner.
  it("returns the JSON itself when nothing in it is secret", () => {
    const json = JSON.stringify({ hooks: {} });
    expect(settingsArgument(SESSION, json, false, "linux")).toBe(json);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  // An inline `--settings` is visible to every user on the host through `ps`, and a
  // provider session's settings carry its API token.
  it("writes a private file and returns its path when it is", () => {
    const json = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-secret" }, hooks: {} });
    const arg = settingsArgument(SESSION, json, true);
    expect(arg).toBe(fileFor(SESSION));
    expect(arg).not.toContain("sk-secret");
    expect(readFileSync(arg, "utf8")).toBe(json);
  });

  // The file holds an API token, so who can read it is the point of writing it at all.
  // How that is enforced differs by platform, so the assertion does too: POSIX has mode
  // bits, Windows has none — node maps `mode` to the read-only attribute there and
  // stat reports 0o666 — and the containment below is what protects it instead.
  it("keeps the file inside the user's own profile directory", () => {
    const arg = settingsArgument(SESSION, "{}", true);
    expect(arg.startsWith(path.join(os.homedir(), ".mulmoterminal", "settings") + path.sep)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("keeps the file readable only by its owner", () => {
    const arg = settingsArgument(SESSION, "{}", true);
    expect(statSync(arg).mode & 0o777).toBe(0o600);
  });
});

describe("withSettingsCleanup", () => {
  // A session that never starts never reaches reap(), where the cleanup normally happens
  // — so without this a failed spawn leaves a token-bearing file on disk.
  it("removes the file when the spawn throws, and re-throws", () => {
    settingsArgument(SESSION, '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-secret"}}', true);
    expect(existsSync(fileFor(SESSION))).toBe(true);
    expect(() =>
      withSettingsCleanup(SESSION, () => {
        throw new Error("spawn failed");
      }),
    ).toThrow(/spawn failed/);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  it("keeps the file — the session needs it — when the spawn succeeds", () => {
    settingsArgument(SESSION, "{}", true);
    expect(withSettingsCleanup(SESSION, () => "entry")).toBe("entry");
    expect(existsSync(fileFor(SESSION))).toBe(true);
  });

  // The prompt file is written while argv is being built, so a spawn that throws afterwards
  // leaves it behind exactly as the settings file used to (#1516). Every file kind a Windows
  // spawn writes has to come back out on this path, not just the one it was written for.
  it("removes every file a Windows spawn wrote when it throws", () => {
    settingsArgument(SESSION, "{}", false, "win32");
    mcpConfigArgument(SESSION, "{}", "win32");
    appendedPromptArgument(SESSION, "first line\nsecond line", "win32");
    expect([fileFor(SESSION), mcpFileFor(SESSION), promptFileFor(SESSION)].every(existsSync)).toBe(true);
    expect(() =>
      withSettingsCleanup(SESSION, () => {
        throw new Error("spawn failed");
      }),
    ).toThrow(/spawn failed/);
    expect([fileFor(SESSION), mcpFileFor(SESSION), promptFileFor(SESSION)].filter(existsSync)).toEqual([]);
  });
});

describe("cleanupSessionSettings", () => {
  it("is a no-op for a session that never wrote one", () => {
    expect(() => cleanupSessionSettings("never-existed-session")).not.toThrow();
  });
});

// #813: on Windows a `.cmd`-installed Claude is launched through cmd.exe, so an inline JSON
// argument is parsed by cmd and then by the child's CRT — two parsers that disagree about
// quoting. A path carries no quotes and no metacharacters, so the layer stops mattering.
describe("the Windows reason for a file", () => {
  const json = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "curl -d @- >/dev/null 2>&1" }] }] } });

  it("writes a file on win32 even when nothing is secret", () => {
    expect(settingsArgument(SESSION, json, false, "win32")).toBe(fileFor(SESSION));
    expect(readFileSync(fileFor(SESSION), "utf8")).toBe(json);
  });

  it("keeps POSIX inline, so a working platform is untouched", () => {
    expect(settingsArgument(SESSION, json, false, "darwin")).toBe(json);
    expect(settingsArgument(SESSION, json, false, "linux")).toBe(json);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  it("gives --mcp-config its own file, so the two never overwrite each other", () => {
    const settings = settingsArgument(SESSION, json, false, "win32");
    const mcp = mcpConfigArgument(SESSION, '{"mcpServers":{}}', "win32");
    expect(mcp).toBe(mcpFileFor(SESSION));
    expect(mcp).not.toBe(settings);
    expect(readFileSync(settings, "utf8")).toBe(json);
    expect(readFileSync(mcp, "utf8")).toBe('{"mcpServers":{}}');
  });

  it("passes --mcp-config inline off Windows", () => {
    expect(mcpConfigArgument(SESSION, "{}", "darwin")).toBe("{}");
  });

  // A launcher chip used to have a THIRD variant here, writing the file unconditionally because a
  // command line cannot carry JSON. Chips get no MCP config at all now, so only the two argv
  // variants above remain.

  // reap() calls this once per session; it has to take BOTH files or the mcp one outlives
  // every Windows session.
  it("cleans up every file a session wrote", () => {
    settingsArgument(SESSION, json, false, "win32");
    mcpConfigArgument(SESSION, "{}", "win32");
    appendedPromptArgument(SESSION, "line one\nline two", "win32");
    cleanupSessionSettings(SESSION);
    expect(existsSync(fileFor(SESSION))).toBe(false);
    expect(existsSync(mcpFileFor(SESSION))).toBe(false);
    expect(existsSync(promptFileFor(SESSION))).toBe(false);
  });

  // The whole point of the file: the newlines survive it, which is what the command line
  // could not do.
  it("writes the prompt verbatim, newlines and all", () => {
    const written = appendedPromptArgument(SESSION, "line one\nline two\n", "win32");
    expect(written).toEqual({ kind: "file", path: promptFileFor(SESSION) });
    if (written.kind !== "file") throw new Error("expected a file");
    expect(readFileSync(written.path, "utf8")).toBe("line one\nline two\n");
  });
});

// What a real Windows spawn produces, asserted against the thing that actually decides —
// cmd-escape, through the resolver that calls it. Stating it here rather than per flag is the
// point: #813 was a quote, #1516 was a newline in a flag added two years later, and a test that
// checks the characters it happens to know about only ever catches the bug it was written for.
describe("the argv a Windows spawn ends up with", () => {
  // An npm-global install: `claude` on PATH is a .cmd shim, so the launch goes through cmd.exe.
  const asWindowsLaunch = (args: string[]) =>
    resolvePtyLaunch("claude", args, "win32", "C:\\npm;C:\\Windows\\System32", "C:\\Windows\\System32\\cmd.exe", (candidate) =>
      /claude\.cmd$|cmd\.exe$/i.test(candidate),
    );

  const windowsSpawnArgs = () => {
    const settings = settingsArgument(SESSION, hookSettingsJson({ host: "127.0.0.1", port: 34567, sessionId: SESSION }), false, "win32");
    const mcpConfig = mcpConfigArgument(
      SESSION,
      JSON.stringify({ mcpServers: { "mulmoterminal-gui": { type: "http", url: "http://127.0.0.1:34567/api/mcp/x" } } }),
      "win32",
    );
    // Both sections on, exactly as a default spawn resolves them: 40-odd lines of markdown.
    const prompt = appendedSystemPrompt({ dirSetting: null, globalSetting: true, workdirFooter: "work in mulmoterminal2" });
    return buildClaudeArgs({
      model: null,
      sessionId: SESSION,
      resume: null,
      canResume: false,
      settings,
      permissionMode: "auto",
      attachGuiMcp: true,
      mcpConfig,
      allowedTools: "mulmoterminal_readXPost,mulmoterminal_searchX",
      appendedPrompt: prompt === null ? null : appendedPromptArgument(SESSION, prompt, "win32"),
    });
  };

  // The regression itself (#1516): every Claude session on a .cmd install failed to start,
  // because the appended prompt is multi-line and a command line cannot encode a newline.
  it("can actually be put on a command line", () => {
    expect(() => asWindowsLaunch(windowsSpawnArgs())).not.toThrow();
  });

  // Named individually so a failure says WHICH argument, not just that the line was refused.
  it("carries no argument a command line cannot represent", () => {
    const unrepresentable = windowsSpawnArgs().filter((arg) => /[\0\r\n]/.test(arg));
    expect(unrepresentable).toEqual([]);
  });

  // #813: with every large payload travelling as a path, nothing claude is launched with holds a
  // quote — so no parser downstream, however unforgiving, has anything to lose.
  it("contains no quote at all once the payloads are files", () => {
    expect(windowsSpawnArgs().filter((a) => a.includes('"'))).toEqual([]);
  });

  // The prompt reaches the session either way; only the flag differs. Off Windows it stays inline,
  // so nothing about the common path changed.
  it("sends the prompt by path on Windows and inline everywhere else", () => {
    expect(windowsSpawnArgs()).toContain("--append-system-prompt-file");
    const prompt = appendedSystemPrompt({ dirSetting: null, globalSetting: true, workdirFooter: null });
    expect(appendedPromptArgument(SESSION, prompt ?? "", "darwin")).toEqual({ kind: "inline", text: prompt });
  });
});

// A crash never reaches reap(), so its sessions' settings files stay behind — and a provider
// session's file holds its API token, which then outlives the session, survives being rotated
// or revoked, and survives the provider being removed from the config.
describe("pruneOrphanSettings", () => {
  const dirs: string[] = [];
  const tmpDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-prune-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const write = (dir: string, name: string) => writeFileSync(path.join(dir, name), "{}");

  const DEAD = "11111111-2222-3333-4444-555555555555";
  const ALIVE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  // EVERY file kind, not just the two that existed when this was written: the sweep reads the
  // session id back out of the name, so a kind the parser does not know is one nothing ever
  // collects. The prompt file is `.txt`, which a `.json`-only rule silently skipped (#1516).
  it("drops every file of a session that did not survive", () => {
    const dir = tmpDir();
    write(dir, `${DEAD}.json`);
    write(dir, `${DEAD}-mcp.json`);
    write(dir, `${DEAD}-prompt.txt`);
    expect(pruneOrphanSettings(new Set(), dir).sort()).toEqual([`${DEAD}-mcp.json`, `${DEAD}-prompt.txt`, `${DEAD}.json`]);
    expect(existsSync(path.join(dir, `${DEAD}.json`))).toBe(false);
    expect(existsSync(path.join(dir, `${DEAD}-mcp.json`))).toBe(false);
    expect(existsSync(path.join(dir, `${DEAD}-prompt.txt`))).toBe(false);
  });

  // The whole point of the liveIds argument: a tmux-backed session is still running with the
  // settings it was started with, so taking its file away is the one thing this must not do.
  it("keeps the files of a session that survived", () => {
    const dir = tmpDir();
    write(dir, `${ALIVE}.json`);
    write(dir, `${ALIVE}-mcp.json`);
    write(dir, `${ALIVE}-prompt.txt`);
    expect(pruneOrphanSettings(new Set([ALIVE]), dir)).toEqual([]);
    expect(existsSync(path.join(dir, `${ALIVE}.json`))).toBe(true);
    expect(existsSync(path.join(dir, `${ALIVE}-mcp.json`))).toBe(true);
    expect(existsSync(path.join(dir, `${ALIVE}-prompt.txt`))).toBe(true);
  });

  // The guard that keeps this from clearing out a directory that is ours but not only ours —
  // including a name that is a session id in a shape we never write. Widening the parser by
  // crossing extensions with suffixes would have swept `<id>.txt`, which nothing here produces.
  it.each([["notes.txt"], ["README.json"], [`${DEAD}.txt`], [`${DEAD}-prompt.json`], [`${DEAD}-other.txt`]])(
    "leaves %s alone — not a name a session writes",
    (name) => {
      const dir = tmpDir();
      write(dir, name);
      expect(pruneOrphanSettings(new Set(), dir)).toEqual([]);
      expect(existsSync(path.join(dir, name))).toBe(true);
    },
  );

  // The field incident (#1061): on Windows there is no tmux, so `liveIds` is empty and every
  // settings file read as a leftover — including the eight belonging to a peer's LIVE sessions.
  // The cutoff is what a second instance can honestly claim: a file older than the earliest
  // running peer cannot be that peer's.
  describe("with another instance running (#1061)", () => {
    const PEER_STARTED = 10_000;
    const older = (dir: string, name: string) => {
      write(dir, name);
      utimesSync(path.join(dir, name), new Date(PEER_STARTED - 5_000), new Date(PEER_STARTED - 5_000));
    };
    const newer = (dir: string, name: string) => {
      write(dir, name);
      utimesSync(path.join(dir, name), new Date(PEER_STARTED + 5_000), new Date(PEER_STARTED + 5_000));
    };

    it("keeps a file written after a live peer started — it may be that peer's", () => {
      const dir = tmpDir();
      newer(dir, `${DEAD}.json`);
      newer(dir, `${DEAD}-mcp.json`);
      expect(pruneOrphanSettings(new Set(), dir, PEER_STARTED)).toEqual([]);
      expect(existsSync(path.join(dir, `${DEAD}.json`))).toBe(true);
    });

    it("still drops a file written before every live peer — nobody running can own it", () => {
      const dir = tmpDir();
      older(dir, `${DEAD}.json`);
      expect(pruneOrphanSettings(new Set(), dir, PEER_STARTED)).toEqual([`${DEAD}.json`]);
    });

    it("prunes exactly as before when nothing else is running", () => {
      // A lone instance must keep cleaning up after its own crash — that is what the prune is for.
      const dir = tmpDir();
      newer(dir, `${DEAD}.json`);
      expect(pruneOrphanSettings(new Set(), dir, null)).toEqual([`${DEAD}.json`]);
    });

    it("keeps a surviving session's file whatever the cutoff says", () => {
      const dir = tmpDir();
      older(dir, `${ALIVE}.json`);
      expect(pruneOrphanSettings(new Set([ALIVE]), dir, PEER_STARTED)).toEqual([]);
    });
  });

  // Flagged by Codex on #822: the first version matched ANY `*.json`, so a file that merely
  // shares the extension — the exact case its own comment promised to leave alone — was
  // deleted. The directory being ours is not a reason to remove something we did not write.
  it("leaves anything that is not one of ours alone, including other .json files", () => {
    const dir = tmpDir();
    for (const name of ["notes.txt", "README.md", "notes.json", "backup.json", "not-a-uuid-mcp.json"]) write(dir, name);
    expect(pruneOrphanSettings(new Set(), dir)).toEqual([]);
    for (const name of ["notes.txt", "README.md", "notes.json", "backup.json", "not-a-uuid-mcp.json"]) {
      expect(existsSync(path.join(dir, name)), name).toBe(true);
    }
  });

  it("is a no-op when nothing has ever been written", () => {
    expect(pruneOrphanSettings(new Set(), path.join(tmpDir(), "never-created"))).toEqual([]);
  });
});
