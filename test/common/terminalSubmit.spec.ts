// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TERMINAL_SUBMIT_MODE,
  TERMINAL_SUBMIT_MODES,
  isTerminalSubmitMode,
  submitSequence,
  newlineSequence,
  submitSequenceForAgent,
  submittableLine,
  submittableLineForAgent,
  enterKeyOverride,
  type EnterKeyEvent,
  type TerminalSubmitMode,
} from "../../common/terminalSubmit.js";

const CR = "\r";
const ESC_CR = "\x1b\r";

describe("terminalSubmit constants", () => {
  it("defaults to the standard CR binding", () => {
    expect(DEFAULT_TERMINAL_SUBMIT_MODE).toBe("cr");
  });

  it("submit and newline are the two sequences, swapped per mode", () => {
    expect(submitSequence("cr")).toBe(CR);
    expect(newlineSequence("cr")).toBe(ESC_CR);
    expect(submitSequence("esc-cr")).toBe(ESC_CR);
    expect(newlineSequence("esc-cr")).toBe(CR);
  });

  // In every mode, submit and newline must be different bytes — else Enter and
  // Shift+Enter would be indistinguishable to the host.
  it.each(TERMINAL_SUBMIT_MODES)("submit and newline differ in %s mode", (mode) => {
    expect(submitSequence(mode)).not.toBe(newlineSequence(mode));
  });
});

describe("submitSequenceForAgent", () => {
  // The mapping is Claude's binding, so only a Claude session follows it.
  it("applies the configured mapping to Claude sessions", () => {
    expect(submitSequenceForAgent("claude", "cr")).toBe(CR);
    expect(submitSequenceForAgent("claude", "esc-cr")).toBe(ESC_CR);
  });

  // A shell/codex/command session (or an unknown/missing agent) must keep plain CR even in
  // esc-cr mode — ESC+CR is Alt+Enter to a shell, not submit.
  it.each(["shell", "codex", "bash", undefined])("keeps plain CR for non-Claude agent %j", (agent) => {
    expect(submitSequenceForAgent(agent, "cr")).toBe(CR);
    expect(submitSequenceForAgent(agent, "esc-cr")).toBe(CR);
  });
});

// #1142: Claude Code holds a completion menu open while the cursor sits at the end of a
// `/command` or `@path` token, and while it is open the ESC of an ESC+CR submit is eaten as the
// menu's dismiss key — the line never submits, however often it is resent. One trailing space
// ends the token. Measured against Claude Code 2.1.220 for both trigger characters.
describe("submittableLine", () => {
  it("ends a slash command with a space, so no command menu is holding the submit", () => {
    expect(submittableLine("/sync-repos")).toBe("/sync-repos ");
  });

  // Not just `/`: a message whose last token is an @path leaves the FILE picker open, which is
  // why the rule is unconditional instead of a list of Claude Code's trigger characters — one we
  // failed to enumerate would silently restore the dead end.
  it("ends an @path mention with a space too", () => {
    expect(submittableLine("look at @common/terminalSubmit.ts")).toBe("look at @common/terminalSubmit.ts ");
  });

  it("ends ordinary prose the same way — no trigger detection to drift", () => {
    expect(submittableLine("run the tests")).toBe("run the tests ");
  });

  it.each(["/help ", "already ends in a space ", "tabbed\t", ""])("adds nothing when no token can be open at the end (%j)", (text) => {
    expect(submittableLine(text)).toBe(text);
  });

  // A multi-line block (pasteAndSubmit) already parks the cursor on a fresh line, where no
  // completion token can be open.
  it("leaves a block ending in a newline alone", () => {
    expect(submittableLine("line1\nline2\n")).toBe("line1\nline2\n");
  });

  // The whole payload it may add is one space: never a control byte, never a second space, and
  // never an edit to what the caller wrote.
  it.each(["/x", "", "a\nb", "café 😀", "ls -la", "@", "/", "  leading kept"])("adds at most one trailing space and changes nothing else (%j)", (text) => {
    const out = submittableLine(text);
    expect([text, `${text} `]).toContain(out);
    expect(out.startsWith(text)).toBe(true);
    expect(out).not.toMatch(/ {2}$/);
  });
});

// The guard belongs to Claude Code and to nothing else. Everywhere else the space would be REAL
// input: measured in a live zsh, `echo foo\` + CR waits at a continuation prompt while
// `echo foo\ ` + CR runs and prints `foo`, so a shell's bytes must stay exactly what was written.
describe("submittableLineForAgent", () => {
  it("guards a Claude session", () => {
    expect(submittableLineForAgent("claude", "/sync-repos")).toBe("/sync-repos ");
  });

  it.each(["shell", "codex", "bash", undefined])("leaves a %j session byte-exact", (agent) => {
    expect(submittableLineForAgent(agent, "/sync-repos")).toBe("/sync-repos");
    expect(submittableLineForAgent(agent, "echo foo\\")).toBe("echo foo\\");
  });

  // Same scoping as submitSequenceForAgent, so the two cannot drift into disagreeing about which
  // sessions follow Claude Code's behaviour.
  it.each(["claude", "shell", "codex", undefined])("agrees with submitSequenceForAgent on who is Claude (%j)", (agent) => {
    const guarded = submittableLineForAgent(agent, "x") !== "x";
    const followsMapping = submitSequenceForAgent(agent, "esc-cr") !== CR;
    expect(guarded).toBe(followsMapping);
  });
});

describe("isTerminalSubmitMode", () => {
  it("accepts the known modes", () => {
    expect(isTerminalSubmitMode("cr")).toBe(true);
    expect(isTerminalSubmitMode("esc-cr")).toBe(true);
  });

  it.each([undefined, null, "", "CR", "enter", 1, {}, ["cr"]])("rejects %j", (v) => {
    expect(isTerminalSubmitMode(v)).toBe(false);
  });
});

describe("enterKeyOverride", () => {
  const ev = (over: Partial<EnterKeyEvent>): EnterKeyEvent => ({
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...over,
  });

  describe("cr mode (default — unchanged behaviour)", () => {
    const mode: TerminalSubmitMode = "cr";
    it("leaves a bare Enter to xterm's native \\r (submit)", () => {
      expect(enterKeyOverride(mode, ev({}))).toBeNull();
    });
    it("overrides Shift+Enter to the newline sequence (ESC+CR)", () => {
      expect(enterKeyOverride(mode, ev({ shiftKey: true }))).toBe(ESC_CR);
    });
    // Option/Alt+Enter is left to macOptionIsMeta (native ESC+CR) rather than intercepted,
    // exactly as before the setting existed.
    it("leaves Option/Alt+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ altKey: true }))).toBeNull();
    });
    it("leaves Ctrl+Enter and Meta+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ ctrlKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ metaKey: true }))).toBeNull();
    });
  });

  describe("esc-cr mode (reversed binding)", () => {
    const mode: TerminalSubmitMode = "esc-cr";
    it("intercepts a bare Enter to submit with ESC+CR", () => {
      expect(enterKeyOverride(mode, ev({}))).toBe(ESC_CR);
    });
    it("makes Shift+Enter a newline (CR)", () => {
      expect(enterKeyOverride(mode, ev({ shiftKey: true }))).toBe(CR);
    });
    // Overrides macOptionIsMeta's ESC+CR so Option/Alt+Enter is a newline, like Shift+Enter.
    it("makes Option/Alt+Enter a newline (CR)", () => {
      expect(enterKeyOverride(mode, ev({ altKey: true }))).toBe(CR);
      expect(enterKeyOverride(mode, ev({ altKey: true, shiftKey: true }))).toBe(CR);
    });
    it("leaves Ctrl+Enter and Meta+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ ctrlKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ metaKey: true }))).toBeNull();
    });
  });

  // The IME guard is what keeps a Japanese candidate-confirm Enter from being eaten as a
  // submit in esc-cr mode — the one place a bare Enter is intercepted.
  it("never intercepts while an IME is composing", () => {
    for (const mode of TERMINAL_SUBMIT_MODES) {
      expect(enterKeyOverride(mode, ev({ isComposing: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ isComposing: true, shiftKey: true }))).toBeNull();
    }
  });

  it("ignores keyup and non-Enter keys in both modes", () => {
    for (const mode of TERMINAL_SUBMIT_MODES) {
      expect(enterKeyOverride(mode, ev({ type: "keyup" }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ type: "keyup", shiftKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ key: "a" }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ key: "a", shiftKey: true }))).toBeNull();
    }
  });
});
