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
import { FakeWebSocket } from "../../helpers/xtermDouble";
import { setCopyOnSelect } from "../../../src/composables/copyOnSelect";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

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

// Copy-on-select (#900). The decision itself is unit-tested in terminalClipboard.spec; what is
// asserted here is the WIRING — that the drag's flood of events becomes at most one clipboard
// write, and that the setting is what gates it.
describe("copy-on-select wiring", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const execCommand = vi.fn<(commandId: string) => boolean>(() => true);
  let cellEl: HTMLDivElement;
  // Torn down in afterEach rather than inline, so a failing assertion cannot leave a focused node
  // in the document — the fallback tests read document.activeElement, so one failure would
  // cascade into the others.
  let elsewhere: HTMLInputElement | null = null;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    mockTermState.onSelectionChange = () => {};
    mockTermState.selection = "";
    mockTermState.hasSelection = false;
    mockTermState.helperTextarea = null;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    execCommand.mockClear();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    // jsdom implements no execCommand at all, and the fallback needs a real one to observe.
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true, writable: true });
    // In the document, not detached: the fallback's focus check is answered by
    // document.activeElement, which only follows focus() for an element that is actually attached.
    cellEl = document.createElement("div");
    document.body.appendChild(cellEl);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // unstubAllGlobals does NOT undo defineProperty on `document`, and jsdom ships no native
    // execCommand — leaving the stub would hand every later suite one that silently returns true.
    Reflect.deleteProperty(document, "execCommand");
    setCopyOnSelect(false);
    conn.release("cell-select");
    cellEl.remove();
    elsewhere?.remove();
    elsewhere = null;
  });

  const attachTerminal = (): void => {
    conn.attach("cell-select", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, cellEl);
  };

  // The selection as the terminal would report it — both halves, since the wiring reads each for a
  // different job (hasSelection per event, getSelection once it settles).
  const select = (text: string): void => {
    mockTermState.selection = text;
    mockTermState.hasSelection = text !== "";
    mockTermState.onSelectionChange();
  };

  // xterm fires on every coordinate change, so a drag is a burst. Writing each one would fill the
  // OS clipboard history (Win+V) with partial selections — only the settled text may land.
  it("writes once for a whole drag, with the text the selection settled on", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    for (const partial of ["npm", "npm run", "npm run build"]) {
      select(partial);
      await vi.advanceTimersByTimeAsync(20); // still mid-drag: under the settle window
    }
    expect(writeText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("npm run build");
  });

  // The default. Highlighting must not touch the clipboard for anyone who did not ask for this.
  it("writes nothing while the setting is off", async () => {
    attachTerminal();
    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  // A selection can settle again unchanged (a drag that runs past the end of a line moves the
  // coordinates without moving the text). A second write buys nothing and costs a duplicate entry
  // in the OS clipboard history.
  it("does not write the same selection twice while it stands", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  // But once the selection is gone, selecting the same text is a fresh intent — the user may have
  // copied something else in between, and "you already copied that" would leave them holding the
  // wrong thing with nothing to show for it.
  it("copies the same text again after the selection was cleared", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    select(""); // a click elsewhere in the terminal
    select("npm run build"); // re-dragged inside the same settle window as the clear
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  // The whole answer to reaching this app at http://<lan-ip>: browsers restrict the Clipboard API
  // to secure contexts, so `navigator.clipboard` is not merely blocked there, it is ABSENT. Asking
  // xterm to copy through its own listener is what still works.
  it("falls back to xterm's own copy when the browser exposes no clipboard API", async () => {
    setCopyOnSelect(true);
    vi.stubGlobal("navigator", {}); // an insecure context
    attachTerminal();
    mockTermState.helperTextarea?.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  // Same route when the API exists but refuses (no document focus, permission denied): one failure
  // must not end the attempt.
  it("falls back after a rejected clipboard write", async () => {
    setCopyOnSelect(true);
    writeText.mockRejectedValue(new Error("not focused"));
    attachTerminal();
    mockTermState.helperTextarea?.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  // The fallback needs the terminal's textarea focused, and deliberately does NOT take focus to get
  // it: if the user has moved on in the settle window, pulling focus back mid-typing would be a
  // worse outcome than a selection that did not copy.
  it("gives up rather than stealing focus back from wherever it went", async () => {
    setCopyOnSelect(true);
    vi.stubGlobal("navigator", {});
    attachTerminal();
    elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
  });

  // A clipboard write can stay pending far longer than the settle window — a browser that asks for
  // clipboard permission holds it open until the user answers. Fired as they came due, two writes
  // would then resolve in whatever order the browser picked, and the clipboard could end up with
  // the older selection. Each write therefore waits for the one before it.
  it("holds a newer write until the pending one finishes, so the older text cannot win", async () => {
    setCopyOnSelect(true);
    attachTerminal();
    const finish: Array<() => void> = [];
    writeText.mockImplementation(() => new Promise<void>((resolve) => finish.push(resolve)));

    select("first");
    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1); // in flight, and staying there

    select("second");
    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1); // settled, but must not start yet

    finish[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenNthCalledWith(2, "second");
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
