import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the key handler ensure() registers, so a test can drive it and assert the
// real wiring (send + suppress-default) — hoisted so the mock factory can write to it.
// Defaults to a no-op that returns true, so a test that forgot to attach would see the
// pass-through behavior (and thus fail the Shift+Enter assertion) rather than crash.
const mockKeyState: { handler: (e: unknown) => boolean } = vi.hoisted(() => ({ handler: () => true }));
// The options ensure() passes to `new Terminal({...})`, captured for assertions.
type FakeWheelEvent = { deltaY: number; preventDefault: () => void };
const mockTermState: {
  options: Record<string, unknown>;
  csiHandlers: unknown[][];
  wheelHandler: (ev: FakeWheelEvent) => boolean;
  input: string[];
  bufferType: "normal" | "alternate";
} = vi.hoisted(() => ({ options: {}, csiHandlers: [], wheelHandler: () => true, input: [], bufferType: "normal" }));

// Mock xterm + addons so the manager runs headless (no real DOM terminal / canvas).
// Factories are hoisted above imports, so the fakes are declared INSIDE them.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    constructor(opts: Record<string, unknown>) {
      mockTermState.options = opts;
    }
    // ensure() registers the mouse-tracking guards through this (#729); the guards' own behaviour
    // is covered against a REAL terminal in mouseTrackingGuard.spec.ts.
    parser = { registerCsiHandler: (...args: unknown[]) => mockTermState.csiHandlers.push(args) };
    loadAddon() {}
    registerLinkProvider() {}
    open() {}
    onData() {}
    attachCustomKeyEventHandler(fn: (e: unknown) => boolean) {
      mockKeyState.handler = fn;
    }
    // The wheel guard (#737) is driven directly by the stale-mode test below.
    attachCustomWheelEventHandler(fn: (ev: FakeWheelEvent) => boolean) {
      mockTermState.wheelHandler = fn;
    }
    get buffer() {
      return { active: { type: mockTermState.bufferType } };
    }
    input(data: string) {
      mockTermState.input.push(data);
    }
    write() {}
    refresh() {}
    reset() {}
    focus() {}
    scrollToBottom() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// A WebSocket double the test drives by hand (fire onopen / onmessage when it wants).
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  url: string;
  readyState = FakeWebSocket.OPEN; // treat as open immediately for send() guards
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

import * as conn from "../../../src/composables/useTerminalConnections";
import { newlineSequence, submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

describe("useTerminalConnections — detached-slot state replay", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release("cell-race"); // tear the slot down so it can't leak into the next test
  });

  it("marks a superseded slot and reconnect() takes it back, resuming the same session", () => {
    conn.attach("cell-race", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    ws?.onopen?.();
    ws?.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-abc", cwd: "/resolved" }) });
    // Another window takes the session over; the server then closes this socket.
    ws?.onmessage?.({ data: JSON.stringify({ type: "superseded" }) });
    ws?.onclose?.();
    // The close must NOT downgrade "superseded" to "disconnected", and no auto-reconnect fires.
    expect(conn.connView.get("cell-race")?.status).toBe("superseded");
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Reconnect opens a fresh socket that resumes the same session id.
    conn.reconnect("cell-race");
    expect(conn.connView.get("cell-race")?.status).toBe("connecting");
    const ws2 = FakeWebSocket.instances.at(-1);
    expect(ws2).not.toBe(ws);
    expect(ws2?.url).toContain("session=sess-abc");

    // A second reconnect while it's connecting again (sawExit already cleared) is a no-op.
    conn.reconnect("cell-race");
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("replays a session id learned WHILE DETACHED to the handlers bound on reattach", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1); // fresh launch, no id yet
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    // User navigates away BEFORE the server reports the session id.
    conn.detach("cell-race", el1);
    expect(conn.connView.get("cell-race")).toBeTruthy(); // socket/slot still alive

    // Server NOW assigns the id + resolves the cwd — handlers are detached, so the
    // first view's callbacks must NOT fire (it's gone).
    ws.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-123", cwd: "/resolved" }) });
    expect(first.onSession).not.toHaveBeenCalled();

    // Coming back must catch the parent up: the freshly-bound handlers receive the
    // id/cwd that arrived while detached — without this the cell stays session:null
    // and is unrestorable on reload.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    const el2 = document.createElement("div");
    conn.attach("cell-race", target(null), second, el2);
    expect(second.onSession).toHaveBeenCalledWith("sess-123");
    expect(second.onCwd).toHaveBeenCalledWith("/resolved");
  });

  it("wires the Enter handler through ensure() (cr mode): sends \\x1b\\r on Shift+Enter and cancels the default", () => {
    mockKeyState.handler = () => true; // reset (the mock persists across tests)
    setTerminalSubmitMode("cr");
    conn.attach("cell-key", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open so send() passes the readyState guard

    const preventDefault = vi.fn();
    const shiftEnter = { type: "keydown", key: "Enter", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault };
    expect(mockKeyState.handler(shiftEnter)).toBe(false); // false => xterm won't also emit \r
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));
    expect(preventDefault).toHaveBeenCalled(); // cancels the default so no follow-up keypress leaks a \r

    // A plain Enter is left to xterm (returns true, sends nothing extra).
    ws.sent.length = 0;
    expect(
      mockKeyState.handler({
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      }),
    ).toBe(true);
    expect(ws.sent).toHaveLength(0);
    conn.release("cell-key");
  });

  it("wires the Enter handler through ensure() (esc-cr mode): submits a bare Enter with \\x1b\\r and makes Shift+Enter a \\r newline", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      conn.attach("cell-esc", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();

      // Bare Enter → submit (ESC+CR), default cancelled.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));

      // Shift+Enter → newline (CR).
      ws.sent.length = 0;
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("esc-cr") }));

      // An IME candidate-confirm Enter must NOT be eaten as a submit — the guard that
      // protects Japanese input in the one mode where a bare Enter is intercepted.
      ws.sent.length = 0;
      const composing = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: true,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(composing)).toBe(true);
      expect(ws.sent).toHaveLength(0);

      conn.release("cell-esc");
    } finally {
      setTerminalSubmitMode("cr"); // module global — reset so later tests see the default
    }
  });

  it("does NOT apply esc-cr to a shell cell — a bare Enter stays native \\r (scoped to Claude sessions)", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      const shellTarget = { ...target(null), launcher: { shell: true as const } };
      conn.attach("cell-shell", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();
      ws.sent.length = 0; // drop the socket's init sends so we only see what the key emits

      // A shell's bare Enter must NOT be rewritten to ESC+CR — it stays xterm's native \r.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(true); // passes through to xterm
      expect(ws.sent).toHaveLength(0);

      // Shift+Enter keeps the standard newline (ESC+CR), same as before the setting existed.
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));

      conn.release("cell-shell");
    } finally {
      setTerminalSubmitMode("cr");
    }
  });

  it("configures xterm with macOptionIsMeta so macOS Option acts as Meta (Alt bindings reach the PTY)", () => {
    mockTermState.options = {};
    conn.attach("cell-opt", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.macOptionIsMeta).toBe(true);
    conn.release("cell-opt");
  });

  // Selecting text must not hand the drag to the agent as mouse reports (#729). `allowProposedApi`
  // is load-bearing rather than cosmetic: `term.parser` throws without it, so a terminal would fail
  // to construct at all. macOptionClickForcesSelection is the macOS escape hatch — there, xterm
  // bypasses mouse mode for Option+drag ONLY when it is set (elsewhere Shift needs no option).
  it("registers the mouse-tracking guard on DECSET and DECRST, with the options it needs", () => {
    mockTermState.options = {};
    mockTermState.csiHandlers = [];
    conn.attach("cell-mouse", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.allowProposedApi).toBe(true);
    expect(mockTermState.options.macOptionClickForcesSelection).toBe(true);
    // SET swallows; RESET is only observed (must keep returning false) so the wheel-report
    // record can follow the app's own mode teardown (#737) — see mouseTrackingGuard.spec.ts.
    expect(mockTermState.csiHandlers.map(([id]) => id)).toEqual([
      { prefix: "?", final: "h" },
      { prefix: "?", final: "l" },
    ]);
    conn.release("cell-mouse");
  });

  // The swallowed modes describe ONE session. An app that dies without sending DECRST would
  // otherwise leave the slot believing the next app wants mouse reports, and that app's wheel
  // would deliver escape bytes instead of scrolling — the #729 noise, one layer over (#737).
  it("forgets swallowed mouse modes when the session is replaced, so the wheel guard doesn't leak across a reconnect", () => {
    vi.useFakeTimers();
    mockTermState.csiHandlers = [];
    mockTermState.input = [];
    mockTermState.bufferType = "alternate";
    mockTermState.wheelHandler = () => true;
    conn.attach("cell-race", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));

    const decset = mockTermState.csiHandlers.find(([id]) => (id as { final: string }).final === "h")?.[1] as (p: (number | number[])[]) => boolean;
    decset([1002, 1006]); // the app asks for drag tracking + SGR: swallowed, and remembered
    const wheel = mockTermState.wheelHandler;
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(false);
    expect(mockTermState.input).toEqual(["\x1b[<65;1;1M"]);

    // The app dies WITHOUT the matching DECRST and the socket drops; the slot reconnects.
    FakeWebSocket.instances.at(-1)?.onclose?.();
    vi.advanceTimersByTime(10_000);
    mockTermState.input = [];

    // A later alt-buffer app that never asked for tracking keeps xterm's own scrolling.
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(true);
    expect(mockTermState.input).toEqual([]);
    vi.useRealTimers();
  });

  it("does not replay a session id before the server has assigned one", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1);
    FakeWebSocket.instances.at(-1)?.onopen?.();
    conn.detach("cell-race", el1);

    // No `session` message yet — reattaching must not synthesize a bogus id.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    conn.attach("cell-race", target(null), second, document.createElement("div"));
    expect(second.onSession).not.toHaveBeenCalled();
    expect(second.onCwd).not.toHaveBeenCalled();
  });
});

// Claude Code emits OSC 52 with an EMPTY selection; the clipboard addon's default
// provider only writes for "c", so the empty case must also route to the clipboard.
describe("isSystemClipboard", () => {
  it("routes the empty selection (Claude Code's OSC 52) and explicit 'c' to the clipboard", () => {
    expect(conn.isSystemClipboard("")).toBe(true);
    expect(conn.isSystemClipboard("c")).toBe(true);
  });

  it("ignores primary / select / cut-buffer selections", () => {
    for (const sel of ["p", "s", "0", "7"]) expect(conn.isSystemClipboard(sel)).toBe(false);
  });
});

describe("isOpenableTerminalLink", () => {
  it("opens http and https OSC 8 targets", () => {
    expect(conn.isOpenableTerminalLink("https://github.com/o/r/pull/2541")).toBe(true);
    expect(conn.isOpenableTerminalLink("http://localhost:3000/x")).toBe(true);
    expect(conn.isOpenableTerminalLink("HTTPS://EXAMPLE.COM")).toBe(true); // scheme is case-insensitive
  });

  // A terminal program is untrusted output — a `javascript:`/`file:`/relative target must NOT open.
  it.each(["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.com", "vscode://x", "/rel/path", "example.com", ""])(
    "refuses non-http(s) target %j",
    (uri) => {
      expect(conn.isOpenableTerminalLink(uri)).toBe(false);
    },
  );
});

describe("OSC 8 link handler wiring", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    mockTermState.options = {};
  });

  it("ensure() sets a linkHandler that opens http(s) links and ignores others", () => {
    conn.attach("cell-link", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const handler = mockTermState.options.linkHandler as { activate: (e: unknown, uri: string) => void } | undefined;
    expect(handler).toBeTruthy();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      handler?.activate({}, "https://github.com/o/r/pull/2541");
      expect(open).toHaveBeenCalledWith("https://github.com/o/r/pull/2541", "_blank", "noopener,noreferrer");
      open.mockClear();
      handler?.activate({}, "javascript:alert(1)"); // must not open
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      conn.release("cell-link");
    }
  });
});

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
    const handler = conn.makeEnterHandler(() => "cr", send);
    expect(handler(ev({ shiftKey: true, preventDefault }))).toBe(false); // false => xterm won't also send \r
    expect(send).toHaveBeenCalledWith(newlineSequence("cr"));
    expect(preventDefault).toHaveBeenCalled(); // else the browser fires a keypress and xterm submits a bare \r
  });

  it("cr mode: passes a plain Enter through (returns true, sends nothing)", () => {
    const send = vi.fn();
    const handler = conn.makeEnterHandler(() => "cr", send);
    expect(handler(ev({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("esc-cr mode: submits a bare Enter with the ESC+CR sequence and cancels the default", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeEnterHandler(() => "esc-cr", send);
    expect(handler(ev({ preventDefault }))).toBe(false);
    expect(send).toHaveBeenCalledWith(submitSequence("esc-cr"));
    expect(preventDefault).toHaveBeenCalled();
  });

  it("reads the mode getter on every keydown, so a live config change is honoured", () => {
    const send = vi.fn();
    let mode: "cr" | "esc-cr" = "cr";
    const handler = conn.makeEnterHandler(() => mode, send);
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
      expect(ws.sent).toEqual([JSON.stringify({ type: "input", data: "/compact" })]); // submit not yet
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
    expect(conn.isClaudeTarget({ ...base, codex: true })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, command: { source: "script", index: 0, label: "dev", cwd: null } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, devTerminal: true })).toBe(false);
  });
});

describe("arrowSequence", () => {
  it("uses ESC [ x in normal mode and ESC O x in application-cursor-keys mode", () => {
    expect(conn.arrowSequence("up", false)).toBe("\x1b[A");
    expect(conn.arrowSequence("down", false)).toBe("\x1b[B");
    expect(conn.arrowSequence("right", false)).toBe("\x1b[C");
    expect(conn.arrowSequence("left", false)).toBe("\x1b[D");
    // DECCKM on (Claude Code's TUI, vim, less): the O form.
    expect(conn.arrowSequence("up", true)).toBe("\x1bOA");
    expect(conn.arrowSequence("left", true)).toBe("\x1bOD");
  });
});
