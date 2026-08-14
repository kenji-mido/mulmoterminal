import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The xterm / addon / WebSocket doubles are shared (test/helpers/xtermDouble.ts). The shape below
// is dictated by hoisting: `vi.mock` factories run BEFORE this file's imports, so they cannot
// close over one — hence `await import` inside each factory, and `vi.hoisted` for the state they
// write into (a plain `const` would be in its temporal dead zone when a factory runs).
const { termState: mockTermState, keyState: mockKeyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());

vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(mockTermState, mockKeyState));
vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
vi.mock("@xterm/addon-web-links", async () => (await import("../../helpers/xtermDouble")).webLinksAddonModule());
vi.mock("@xterm/addon-clipboard", async () => (await import("../../helpers/xtermDouble")).clipboardAddonModule());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import * as conn from "../../../src/composables/useTerminalConnections";
import { makeEnterHandler, makeSendHandler } from "../../../src/composables/terminalKeyHandlers";
import { FakeWebSocket } from "../../helpers/xtermDouble";
import { newlineSequence, submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

// The pure key→bytes decision (enterKeyOverride) is covered in test/common/terminalSubmit.spec.ts;
// here we cover the thin wrapper that turns that decision into a send + preventDefault, and that
// it re-reads the mode getter each call so a live config change takes effect.
describe("makeEnterHandler", () => {
  const ev = (
    over: Partial<KeyboardEvent>,
  ): Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "preventDefault"> => ({
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault: () => {},
    ...over,
  });

  it("cr mode: sends the newline sequence on Shift+Enter, cancels the default, and preventDefaults", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeEnterHandler(() => "cr", send);
    expect(handler(ev({ shiftKey: true, preventDefault }))).toBe(false); // false => xterm won't also send \r
    expect(send).toHaveBeenCalledWith(newlineSequence("cr"));
    expect(preventDefault).toHaveBeenCalled(); // else the browser fires a keypress and xterm submits a bare \r
  });

  it("cr mode: passes a plain Enter through (returns true, sends nothing)", () => {
    const send = vi.fn();
    const handler = makeEnterHandler(() => "cr", send);
    expect(handler(ev({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("esc-cr mode: submits a bare Enter with the ESC+CR sequence and cancels the default", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeEnterHandler(() => "esc-cr", send);
    expect(handler(ev({ preventDefault }))).toBe(false);
    expect(send).toHaveBeenCalledWith(submitSequence("esc-cr"));
    expect(preventDefault).toHaveBeenCalled();
  });

  it("reads the mode getter on every keydown, so a live config change is honoured", () => {
    const send = vi.fn();
    let mode: "cr" | "esc-cr" = "cr";
    const handler = makeEnterHandler(() => mode, send);
    expect(handler(ev({}))).toBe(true); // cr: a bare Enter is left to xterm
    mode = "esc-cr";
    expect(handler(ev({}))).toBe(false); // esc-cr: the same key is now intercepted as submit
    expect(send).toHaveBeenCalledWith(submitSequence("esc-cr"));
  });
});

// The GUI-originated sends (header run:"input", skill invocation, worktree commit prompt)
// paste/type text then submit a beat later — that delayed submit byte must follow the same
// Claude-scoped mapping as the keyboard, or a Claude cell in esc-cr mode never submits.
describe("submitText / pasteAndSubmit — delayed submit follows terminalSubmit (Claude-scoped)", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    setTerminalSubmitMode("cr");
  });
  afterEach(() => setTerminalSubmitMode("cr"));

  const openCell = (key: string, t: conn.ConnTarget) => {
    conn.attach(key, t, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    ws.sent.length = 0; // drop init sends
    return ws;
  };

  it("submitText: a Claude cell in esc-cr submits with ESC+CR (text first, submit delayed)", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-st", target(null));
      expect(conn.submitText("cell-st", "/compact")).toBe(true);
      // The trailing space is the #1142 guard: `/compact` alone leaves Claude's command menu
      // open, and while it is open the ESC of the ESC+CR submit is eaten as the menu's dismiss.
      expect(ws.sent).toEqual([JSON.stringify({ type: "input", data: "/compact " })]); // submit not yet
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));
      conn.release("cell-st");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submitText: a shell cell submits with plain \\r even in esc-cr", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-st2", { ...target(null), launcher: { shell: true as const } });
      conn.submitText("cell-st2", "ls");
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: "\r" }));
      expect(ws.sent).not.toContain(JSON.stringify({ type: "input", data: "\x1b\r" }));
      conn.release("cell-st2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pasteAndSubmit: a Claude cell in esc-cr submits with ESC+CR after the paste", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-ps", target(null));
      expect(conn.pasteAndSubmit("cell-ps", "line1\nline2")).toBe(true);
      vi.advanceTimersByTime(200);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));
      conn.release("cell-ps");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submitText: the default cr mode still submits with plain \\r", () => {
    vi.useFakeTimers();
    try {
      const ws = openCell("cell-st3", target(null));
      conn.submitText("cell-st3", "hi");
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: "\r" }));
      conn.release("cell-st3");
    } finally {
      vi.useRealTimers();
    }
  });

  // #1142: the Skill menu types `/<slug>` through submitText, so this path has the same dead end
  // as the phone's — Claude keeps the command menu open on a bare `/slug` and eats the ESC of an
  // ESC+CR submit. The guard space is mode-independent: a cr host submits the same line either
  // way, so both modes send it rather than the guard depending on a setting.
  it.each(["cr", "esc-cr"] as const)("submitText: the skill seed carries the completion guard in %s mode", (mode) => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode(mode);
      const ws = openCell(`cell-guard-${mode}`, target(null));
      conn.submitText(`cell-guard-${mode}`, "/mulmoterminal-decisions");
      expect(ws.sent[0]).toBe(JSON.stringify({ type: "input", data: "/mulmoterminal-decisions " }));
      conn.release(`cell-guard-${mode}`);
    } finally {
      vi.useRealTimers();
    }
  });

  // The guard is Claude Code's behaviour, so a shell cell's bytes stay exactly what was asked for:
  // measured in a live zsh, `echo foo\` + CR waits at a continuation prompt while `echo foo\ ` + CR
  // runs and prints `foo`. Same scoping as the submit bytes above (isClaudeTarget).
  it("submitText: a shell cell's line end is left untouched", () => {
    vi.useFakeTimers();
    try {
      const ws = openCell("cell-sh-guard", { ...target(null), launcher: { shell: true as const } });
      conn.submitText("cell-sh-guard", "echo foo\\");
      expect(ws.sent[0]).toBe(JSON.stringify({ type: "input", data: "echo foo\\" }));
      conn.release("cell-sh-guard");
    } finally {
      vi.useRealTimers();
    }
  });

  // pasteAndSubmit gained the return-to-latest the other two submit paths had (Codex on #1547).
  // What is pinned here is that adding it left the PASTE byte-exact; the restore's own behaviour —
  // what it owes and how it pays it — is pinned against a real xterm in terminalMouseInput.spec.
  it("pasteAndSubmit still sends a byte-exact paste with the return-to-latest wired in", () => {
    const ws = openCell("cell-ps-restore", target("11111111-1111-1111-1111-111111111111"));
    expect(conn.pasteAndSubmit("cell-ps-restore", "hello")).toBe(true);
    // The trailing space is the Claude completion-menu guard (#1142), not the restore.
    expect(ws.sent.map((s) => JSON.parse(s).data)).toContain("\x1b[200~hello \x1b[201~");
  });

  it("pasteAndSubmit: a shell cell's paste is byte-exact too", () => {
    vi.useFakeTimers();
    try {
      const ws = openCell("cell-sh-ps", { ...target(null), launcher: { shell: true as const } });
      conn.pasteAndSubmit("cell-sh-ps", "echo foo\\");
      expect(ws.sent[0]).toBe(JSON.stringify({ type: "input", data: "\x1b[200~echo foo\\\x1b[201~" }));
      conn.release("cell-sh-ps");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pasteAndSubmit: the guard rides inside the bracketed paste, not after the terminator", () => {
    vi.useFakeTimers();
    try {
      const ws = openCell("cell-ps2", target(null));
      conn.pasteAndSubmit("cell-ps2", "read @common/terminalSubmit.ts");
      expect(ws.sent[0]).toBe(JSON.stringify({ type: "input", data: "\x1b[200~read @common/terminalSubmit.ts \x1b[201~" }));
      conn.release("cell-ps2");
    } finally {
      vi.useRealTimers();
    }
  });

  // insertText / pasteText hand the user a draft to read and send themselves, so they must keep
  // exactly what was handed over — a guard space belongs only where WE press Enter.
  it("insertText and pasteText leave the text untouched", () => {
    const ws = openCell("cell-ins", target(null));
    conn.insertText("cell-ins", "/compact");
    conn.pasteText("cell-ins", "line1\nline2");
    expect(ws.sent).toEqual([JSON.stringify({ type: "input", data: "/compact" }), JSON.stringify({ type: "input", data: "\x1b[200~line1\nline2\x1b[201~" })]);
    conn.release("cell-ins");
  });
});

// terminalSubmit is Claude's binding, so it must apply only to Claude cells — a shell /
// codex / command / dev-terminal cell keeps the standard binding regardless of the setting.
describe("isClaudeTarget", () => {
  const base = { sessionId: null, cwd: "/x", devTerminal: false, command: null, launcher: null };

  it("is true for a plain Claude cell", () => {
    expect(conn.isClaudeTarget({ ...base })).toBe(true);
    // A launch (provider/model) choice is Claude-only, so it's still a Claude cell.
    expect(conn.isClaudeTarget({ ...base, launch: { provider: "openrouter", model: "x" } })).toBe(true);
  });

  it("is false for shell / codex / command / dev-terminal cells", () => {
    expect(conn.isClaudeTarget({ ...base, launcher: { shell: true } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, launcher: { index: 0 } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, agent: "codex" })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, agent: "antigravity" })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, command: { source: "script", index: 0, label: "dev", cwd: null } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, devTerminal: true })).toBe(false);
  });
});

// #1005. The pure key->bytes decision (sendBytesFor) is covered in test/common/keymapSend.spec.ts;
// here we cover the wrapper — that it sends, cancels xterm's own handling, and preventDefaults,
// and that it re-reads the keymap each call so editing config.json takes effect without a reload.
describe("makeSendHandler", () => {
  const CTRL_E = "\u0005";
  const key = (
    over: Partial<KeyboardEvent>,
  ): Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "preventDefault"> => ({
    type: "keydown",
    key: "ArrowRight",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    isComposing: false,
    preventDefault: () => {},
    ...over,
  });
  const bound = { send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] };

  it("sends the bytes, cancels xterm's handling, and preventDefaults", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeSendHandler(() => bound, send);
    expect(handler(key({ preventDefault }))).toBe(false); // false => xterm does not also translate the key
    expect(send).toHaveBeenCalledWith(CTRL_E);
    // Without this the browser fires a follow-up keypress that arrives as stray input — the same
    // trap makeEnterHandler documents.
    expect(preventDefault).toHaveBeenCalled();
  });

  it("passes an unbound key through untouched", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeSendHandler(() => bound, send);
    expect(handler(key({ key: "ArrowLeft", preventDefault }))).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("takes no key at all when nothing is bound", () => {
    const send = vi.fn();
    const handler = makeSendHandler(() => ({}), send);
    expect(handler(key({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  // Read through a getter, not captured: the keymap is hydrated asynchronously from /api/config
  // and can change while a terminal is open.
  it("re-reads the keymap on every keystroke", () => {
    const send = vi.fn();
    let keymap: { send?: { key: string; bytes: string }[] } = {};
    const handler = makeSendHandler(() => keymap, send);
    expect(handler(key({}))).toBe(true);
    keymap = bound;
    expect(handler(key({}))).toBe(false);
    expect(send).toHaveBeenCalledWith(CTRL_E);
  });
});
