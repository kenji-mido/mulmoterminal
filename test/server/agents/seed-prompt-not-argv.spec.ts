// @vitest-environment node
//
// One property over every agent that takes a seed prompt as an ARGUMENT: whatever ends up on the
// command line can actually go on one.
//
// Stated once, here, rather than per agent — because that is how it went wrong. #1516 fixed the
// same class for `--append-system-prompt`, and each of these agents' own specs went on asserting
// the seed's argv POSITION, which tests the shape of the bug rather than the rule (#1518).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildGrokArgs } from "../../../server/agents/grok-args.js";
import { buildAntigravityArgs } from "../../../server/agents/antigravity-args.js";
import { buildMuseArgs } from "../../../server/agents/muse-args.js";
import { codexifySkillSeed } from "../../../server/agents/codex-skills.js";
import { seedPromptArgument, cleanupSessionSettings, SEED_ARGV_MAX_BYTES } from "../../../server/session/session-settings.js";
import { resolvePtyLaunch } from "../../../server/infra/resolve-bin.js";
import { escapeBatchArgument } from "../../../server/infra/cmd-escape.js";
import { tmuxNewSessionArgs } from "../../../server/infra/tmux.js";

const SESSION = "seed-argv-spec-session";
const CWD = "C:\\work\\project";
const seedFileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}-seed.txt`);

afterEach(() => cleanupSessionSettings(SESSION));

// What the plugin routes actually hand a spawn. codexifySkillSeed puts a blank line between the
// skill line and the rest, so ANY skill seed with arguments is multi-line — not a corner case.
const SEED = codexifySkillSeed("/gh-review-loop 1517 をトリアージして");

// An npm-global install: the agent on PATH is a .cmd shim, so the launch goes through cmd.exe,
// whose command line has no encoding for a newline.
const asWindowsLaunch = (bin: string, args: string[]) =>
  resolvePtyLaunch(bin, args, "win32", "C:\\npm;C:\\Windows\\System32", "C:\\Windows\\System32\\cmd.exe", (candidate) =>
    new RegExp(`${bin}\\.cmd$|cmd\\.exe$`, "i").test(candidate),
  );

// A seed no command line has room for. Written in Japanese on purpose: 40,000 characters is 120,000
// bytes, and bytes are what the limits are counted in.
const LONG_SEED = "あ".repeat(40_000);

// Each agent's argv, with the seed resolved the way the SPAWNER resolves it — the step the bug was
// missing. Parameterised by platform because the two reasons a seed cannot ride argv do not share
// one: a newline is refused only by Windows, while a command line runs out of room everywhere.
const argvFor = (platform: NodeJS.Platform, seedText: string): Array<[string, string[]]> => {
  const seed = seedPromptArgument(SESSION, seedText, platform);
  return [
    ["grok", buildGrokArgs({ sessionId: "11111111-2222-4333-8444-555555555555", resume: null, model: "grok-4.5", skipPermissions: true, initialPrompt: seed })],
    ["agy", buildAntigravityArgs({ resume: null, model: "agy-1", skipPermissions: true, initialPrompt: seed })],
    ["muse", buildMuseArgs({ resume: null, workspace: CWD, model: "muse-spark-1.2", initialPrompt: seed })],
  ];
};

const windowsArgv = (): Array<[string, string[]]> => argvFor("win32", SEED);

describe("a seed prompt on a Windows command line", () => {
  it("is multi-line for any skill seed with arguments — the reason this rule exists", () => {
    expect(SEED).toContain("\n");
  });

  // The regression itself: with the raw seed on argv this threw UnsafeArgumentError and the
  // session never started.
  it("can actually be put on a command line, for every agent that takes one", () => {
    for (const [agent, args] of windowsArgv()) {
      expect(() => asWindowsLaunch(agent, args), agent).not.toThrow();
    }
  });

  // Named per agent so a failure says WHICH argument, and so a future flag carrying free text
  // fails here rather than at a user's machine.
  it("carries no argument a command line cannot represent", () => {
    for (const [agent, args] of windowsArgv()) {
      expect(
        args.filter((arg) => /[\0\r\n]/.test(arg)),
        agent,
      ).toEqual([]);
    }
  });
});

// The other half of "can go on a command line": there has to be ROOM for it. Asserted against the
// line tmux is actually handed, not against the agent's argv alone — the limit is on the whole
// command, and the agent's arguments are only part of what this server puts on it.
describe("a seed prompt with no room on the command line", () => {
  // Measured against tmux 3.7b on macOS: 16,250 bytes in a single argument was accepted, 16,375
  // refused with "command too long", and two 10,000-byte arguments were refused together — so the
  // ceiling is on the total, at about 16 KiB. The assertion below uses the largest size actually
  // observed to work, so a tmux that raises its limit does not make this test pass for free.
  const TMUX_OBSERVED_OK_BYTES = 16_250;

  // What pty-spawn.ts really spawns for a persistent session. muse's env is the one that grows with
  // the machine rather than the prompt, so it stands in for the rest of the shared budget.
  const tmuxCommandLine = (bin: string, args: string[]): string =>
    tmuxNewSessionArgs("11111111-2222-4333-8444-555555555555", `/usr/local/bin/${bin}`, args, "/Users/someone/git/some/deep/project", {
      MUSE_PLUGIN_DIR: "/Users/someone/.mulmoterminal/muse-plugins",
    }).join(" ");

  it("still leaves the tmux command line well inside the size tmux accepts", () => {
    for (const [agent, args] of argvFor("darwin", LONG_SEED)) {
      expect(Buffer.byteLength(tmuxCommandLine(agent, args), "utf8"), agent).toBeLessThan(TMUX_OBSERVED_OK_BYTES);
    }
  });

  // The same seed WITHOUT the rule, to show the assertion above is not passing on its own. This is
  // the session-killing "command too long", which is why length is handled off Windows too.
  it("would blow past that limit if the seed rode argv", () => {
    const unguarded = buildMuseArgs({ resume: null, workspace: CWD, model: "muse-spark-1.2", initialPrompt: LONG_SEED });
    expect(Buffer.byteLength(tmuxCommandLine("muse", unguarded), "utf8")).toBeGreaterThan(TMUX_OBSERVED_OK_BYTES);
  });

  // cmd.exe stops at 8,191 characters, and what it is handed is the ESCAPED line — escapeBatchArgument
  // doubles every internal quote, so a seed of nothing but quotes arrives at twice its measured size
  // (codex review on #1522). Asserted on the line resolvePtyLaunch actually builds.
  const CMD_MAX_CHARS = 8191;
  const QUOTE_BOMB = '"'.repeat(SEED_ARGV_MAX_BYTES);

  it("leaves the cmd.exe command line inside its limit even when every character doubles", () => {
    for (const [agent, args] of argvFor("win32", QUOTE_BOMB)) {
      const launch = asWindowsLaunch(agent, args);
      // The batch path is the one that goes through cmd; a resolved .exe takes an argv array instead.
      expect(typeof launch.args, agent).toBe("string");
      expect((launch.args as unknown as string).length, agent).toBeLessThan(CMD_MAX_CHARS);
    }
  });

  it("would blow past cmd's limit if the unescaped size were the measure", () => {
    // Exactly what a byte-only guard would have let through: at the budget unescaped, over it escaped.
    expect(Buffer.byteLength(QUOTE_BOMB, "utf8")).toBeLessThanOrEqual(SEED_ARGV_MAX_BYTES);
    expect(escapeBatchArgument(QUOTE_BOMB).length).toBeGreaterThan(SEED_ARGV_MAX_BYTES);
    const unguarded = buildMuseArgs({ resume: null, workspace: CWD, model: "muse-spark-1.2", initialPrompt: QUOTE_BOMB });
    expect((asWindowsLaunch("muse", unguarded).args as unknown as string).length).toBeGreaterThan(CMD_MAX_CHARS);
  });

  it("carries no argument bigger than the budget, for every agent that takes one", () => {
    for (const platform of ["darwin", "win32"] as const) {
      for (const [agent, args] of argvFor(platform, LONG_SEED)) {
        expect(
          args.filter((arg) => Buffer.byteLength(arg, "utf8") > SEED_ARGV_MAX_BYTES),
          `${agent} on ${platform}`,
        ).toEqual([]);
      }
    }
  });
});

describe("seedPromptArgument", () => {
  it("hands back a multi-line seed unchanged off Windows — nothing about that path moves", () => {
    expect(seedPromptArgument(SESSION, SEED, "darwin")).toBe(SEED);
    expect(existsSync(seedFileFor(SESSION))).toBe(false);
  });

  // The indirection is for the case that cannot work, not for Windows as such.
  it("hands back a single-line seed unchanged even on Windows", () => {
    expect(seedPromptArgument(SESSION, "/collect run", "win32")).toBe("/collect run");
    expect(existsSync(seedFileFor(SESSION))).toBe(false);
  });

  it("puts a multi-line seed in a file and names it in one line", () => {
    const argument = seedPromptArgument(SESSION, SEED, "win32");
    expect(argument).not.toContain("\n");
    expect(argument).toContain(seedFileFor(SESSION));
    // Verbatim: the whole point is that the agent gets the instruction it was given, not a
    // flattened paraphrase of it.
    expect(readFileSync(seedFileFor(SESSION), "utf8")).toBe(SEED);
  });

  // Length is the reason that is NOT Windows-only: tmux is what runs out of room first, and tmux is
  // what this server spawns through on macOS and Linux.
  it("puts an oversized seed in a file on every platform, not just Windows", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const argument = seedPromptArgument(SESSION, LONG_SEED, platform);
      expect(argument, platform).toContain(seedFileFor(SESSION));
      expect(readFileSync(seedFileFor(SESSION), "utf8"), platform).toBe(LONG_SEED);
      cleanupSessionSettings(SESSION);
    }
  });

  // A character-count guard would wave this straight through: 2,000 characters, 6,000 bytes. tmux
  // counts the bytes.
  it("measures bytes, not characters — a Japanese seed is three bytes a character", () => {
    const japanese = "あ".repeat(2000);
    expect(japanese.length).toBeLessThan(SEED_ARGV_MAX_BYTES);
    expect(seedPromptArgument(SESSION, japanese, "darwin")).toContain(seedFileFor(SESSION));
    cleanupSessionSettings(SESSION);

    // Same character count in ASCII fits, and is left alone — the rule is about the size on the
    // command line, not about how long the text looks.
    const ascii = "a".repeat(2000);
    expect(seedPromptArgument(SESSION, ascii, "darwin")).toBe(ascii);
    expect(existsSync(seedFileFor(SESSION))).toBe(false);
  });

  it("takes a seed that exactly fills the budget, and files the next byte", () => {
    const exact = "a".repeat(SEED_ARGV_MAX_BYTES);
    expect(seedPromptArgument(SESSION, exact, "darwin")).toBe(exact);
    expect(existsSync(seedFileFor(SESSION))).toBe(false);

    expect(seedPromptArgument(SESSION, `${exact}a`, "darwin")).toContain(seedFileFor(SESSION));
  });

  it("is cleaned up with the session's other files", () => {
    seedPromptArgument(SESSION, SEED, "win32");
    expect(existsSync(seedFileFor(SESSION))).toBe(true);
    cleanupSessionSettings(SESSION);
    expect(existsSync(seedFileFor(SESSION))).toBe(false);
  });
});
