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
import { newlineSequence, submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";
import { clickReportSequences } from "../../../src/composables/mouseReports";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

describe("useTerminalConnections — detached-slot state replay", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release("cell-race"); // tear the slot down so it can't leak into the next test
  });

  it("does NOT replay a stale id when the slot is reattached FOR A DIFFERENT session — reconnects there instead", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target("sess-A"), first, el1);
    const ws = FakeWebSocket.instances.at(-1);
    ws?.onopen?.();
    ws?.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-A", cwd: "/a" }) });
    conn.detach("cell-race", el1);

    // Grid live-sync renumbered cells while detached: this slot now belongs to sess-B.
    // Replaying sess-A upward would overwrite the cell's session — one session duplicated
    // across two cells, which then fight over it (mutual supersede) and share roster meta.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    const el2 = document.createElement("div");
    conn.attach("cell-race", target("sess-B"), second, el2);
    expect(second.onSession).not.toHaveBeenCalledWith("sess-A");
    const ws2 = FakeWebSocket.instances.at(-1);
    expect(ws2).not.toBe(ws); // reconnected…
    expect(ws2?.url).toContain("session=sess-B"); // …at the session the cell actually names
    conn.release("cell-race");
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

  // A parked cell wakes on input (#992), so `onInput` has to mean "the user put something in" and
  // nothing else. It rides the one function every keystroke, bound key and paste funnels through
  // on the way to the socket — which is also why output arriving from the server cannot reach it.
  it("reports user input, and never reports it for output the server sends", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("cr");
    const onInput = vi.fn();
    conn.attach("cell-input", target(null), { onSession: vi.fn(), onCwd: vi.fn(), onInput }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "hello from the agent" }) } as MessageEvent);
    expect(onInput).not.toHaveBeenCalled();

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
    mockKeyState.handler(shiftEnter);
    expect(onInput).toHaveBeenCalled();
    conn.release("cell-input");
  });

  // Clicking a parked cell to READ it must leave it parked — but a click on a mouse-tracking app
  // is delivered as input on the very channel keystrokes use, which is what made the cell wake on
  // the click rather than on the typing. The report still reaches the PTY; it just is not the
  // user typing.
  it("forwards a pointer report to the PTY without calling it user input", () => {
    const onInput = vi.fn();
    conn.attach("cell-click", target(null), { onSession: vi.fn(), onCwd: vi.fn(), onInput }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    const [press] = clickReportSequences(4, 9);
    mockTermState.emitData(press);
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: press }));
    expect(onInput).not.toHaveBeenCalled();

    mockTermState.emitData("x");
    expect(onInput).toHaveBeenCalledTimes(1);
    conn.release("cell-click");
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

// The load-bearing half of #860/#864, and the half nothing asserted until now: changing the font
// changes the CELL METRICS, so cols/rows change and the PTY has to be told. Delete the re-fit from
// setFont and every other test in this repo still passes, while the bug #860 was filed for — a
// canvas grid the shell disagrees with, so the cursor and wrap points drift — comes silently back.
//
// The observable contract is the resize frame on the wire, not a call count, so that is what these
// assert.
describe("setFont — a font change must reach the PTY, not just the canvas", () => {
  const FONT = { size: 14, family: "'JetBrains Mono', monospace" };
  const resizes = (ws: FakeWebSocket) => ws.sent.filter((m) => JSON.parse(m).type === "resize");

  function attachOpenSlot(key: string) {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    conn.attach(key, target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"), undefined, FONT);
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open, so fitAndSyncSize's readyState guard lets the resize through
    ws.sent.length = 0; // ignore the frames attach() itself produced
    return ws;
  }

  afterEach(() => {
    conn.release("cell-font");
  });

  it("applies BOTH options and pushes the new geometry to the PTY", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: 24, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontSize).toBe(24);
    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // A family alone moves the advance width just as a size does, so it must re-fit too — the case
  // #864 added and the one a size-only implementation would quietly miss.
  it("re-fits for a family change on its own, not only a size change", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: FONT.size, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // Terminal.vue's watcher fires on every dir-config resolution, and most directories pin no font
  // at all. Re-fitting there would churn every terminal on every load for nothing.
  it("does nothing when the font is unchanged", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { ...FONT });

    expect(resizes(ws)).toHaveLength(0);
  });

  it("ignores a slot that does not exist rather than throwing", () => {
    expect(() => conn.setFont("cell-not-here", { size: 20, family: "monospace" })).not.toThrow();
  });
});

// The #846 recovery only runs when something calls it, and until now that was a fit or an incoming
// output frame. A cell that is idle gets neither — nothing writes to it, nothing resizes it — so a
// terminal whose write queue is stuck stayed stuck, and the user in front of it read "I type and
// nothing happens" as broken input. The keystroke itself is the missing trigger.
describe("a keystroke into a dead terminal triggers the #846 recovery", () => {
  const KEY = "cell-dead";

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release(KEY);
    // Shared double state: leave the buffer healthy for whatever runs next.
    mockTermState.bufferLength = 24;
  });

  // One task, because guardBufferHealth deliberately re-reads the shape after one: mid-parse a
  // healthy terminal can look short, and a rebuild costs the client-side scrollback.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("rebuilds the terminal and reconnects when the user types into a short buffer", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;
    const sockets = FakeWebSocket.instances.length;

    mockTermState.bufferLength = 10; // fewer lines than the 24 rows the viewport addresses
    mockTermState.emitData("a");
    await settle();

    expect(mockTermState.constructed).toBe(built + 1);
    expect(FakeWebSocket.instances).toHaveLength(sockets + 1); // the rebuild re-attaches the session
  });

  it("leaves a healthy terminal alone — a rebuild costs the scrollback, so typing must not cause one", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;

    mockTermState.emitData("a");
    await settle();

    expect(mockTermState.constructed).toBe(built);
  });

  // A pointer report is the app talking to itself, not someone typing — and a click on a parked
  // cell must stay as free of side effects as it is of waking it (#992).
  it("does not run the probe for a pointer report", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;

    mockTermState.bufferLength = 10;
    mockTermState.emitData(clickReportSequences(1, 1)[0]);
    await settle();

    expect(mockTermState.constructed).toBe(built);
  });
});

// A keystroke that reaches a closed socket is dropped, and nothing about the terminal changes when
// it is — the same silence a working terminal produces for a key it chose not to echo. The view
// gets told so it can say so; the rate limit is what keeps a held-down key from becoming a stream
// of notices.
describe("a keystroke with nowhere to go tells the view", () => {
  const KEY = "cell-dropped";
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    conn.release(KEY);
  });

  function attachClosedSlot(onInputDropped: (willReconnect: boolean) => void, over: Partial<conn.ConnTarget> = {}) {
    conn.attach(KEY, { ...target(null), ...over }, { onInputDropped }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    ws.close(); // the drop / reconnect state the reconnect backoff leaves a cell in
    return ws;
  }

  const droppedInputLines = () => warn.mock.calls.filter((args: unknown[]) => String(args[0]).includes("dropped input"));

  it("reports once while the notice is still on screen, however much the user types", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData("h");
    mockTermState.emitData("i");

    expect(onInputDropped).toHaveBeenCalledOnce();
  });

  // A stretch has no upper bound — the backoff retries forever at a 5s cap — so "once per stretch"
  // meant a server left down said it once and never again, and whoever came back and typed got the
  // silence this notice exists to break (#1316). The log line is the one that stays single: it is
  // read afterwards, where a repeat adds nothing.
  it("reports again once the notice has left the screen, though the stretch is the same", () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);
      mockTermState.emitData("h");

      now.mockReturnValue(1_006_000); // the banner's six seconds are up
      mockTermState.emitData("h");

      expect(onInputDropped).toHaveBeenCalledTimes(2);
      expect(droppedInputLines()).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });

  it("reports again after a reconnect, because that is a new stretch", () => {
    const onInputDropped = vi.fn();
    const ws = attachClosedSlot(onInputDropped);
    mockTermState.emitData("h");

    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.(); // reconnected: whatever is typed now lands
    ws.close(); // …and dropped again
    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledTimes(2);
  });

  it("says a reconnect is coming for an ordinary drop", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(true);
  });

  // The banner promises "Reconnecting…" off this flag, and an exited session gets no reconnect —
  // shouldReconnect refuses one for sawExit. Telling the user to wait for something that is never
  // coming swaps one misleading silence for another, which is what this notice exists to prevent.
  it("says no reconnect is coming once the session has exited", () => {
    const onInputDropped = vi.fn();
    const ws = attachClosedSlot(onInputDropped);
    ws.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 0 }) } as MessageEvent);

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(false);
  });

  // A Run cell's process is unresumable, so the same promise would be just as empty.
  it("says no reconnect is coming for a Run cell", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped, { command: { source: "script", index: 0, label: "echo", cwd: null } });

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(false);
  });

  // Same reason the probe skips them: a click on a parked cell is the app talking, not a person
  // typing, and it must not raise a notice about input nobody gave (#992).
  it("says nothing for a pointer report", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData(clickReportSequences(1, 1)[0]);

    expect(onInputDropped).not.toHaveBeenCalled();
  });

  // The GUI reaches the same socket without going through the keyboard: a header button's text, a
  // skill picked from the menu, a pasted block. Those returned `false` and told nobody, and the one
  // caller that read the result was the exception (#1315) — so the report belongs in the manager,
  // where every host gets it, rather than in each caller that remembers to ask.
  describe("input the GUI sends", () => {
    it("tells the view when a button's text hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.submitText(KEY, "/commit")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    it("tells the view when a paste hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteText(KEY, "a block")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    it("tells the view when a paste-and-submit hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteAndSubmit(KEY, "a block")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    // The quietest one: a dictated sentence, a dropped path, a pasted screenshot's path. The user
    // is watching the input box for text to appear, so nothing about the terminal changes at all.
    it("tells the view when inserted text hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      conn.insertText(KEY, "~/shots/pasted.png ");

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    // Empty text never had anything to deliver, so its `false` is not a drop — reporting it would
    // put a "not connected" banner on a paste of nothing.
    it("says nothing for empty text", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteText(KEY, "")).toBe(false);
      expect(conn.pasteAndSubmit(KEY, "")).toBe(false);
      conn.insertText(KEY, "");

      expect(onInputDropped).not.toHaveBeenCalled();
    });

    // The same "nothing is coming" the keyboard gets, since the wording follows the flag: a Run
    // cell's button must not be told to wait for a reconnect that would re-run its command.
    it("says no reconnect is coming for a Run cell", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped, { command: { source: "script", index: 0, label: "echo", cwd: null } });

      expect(conn.submitText(KEY, "/commit")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(false);
    });
  });
});

// A hidden document must not TAKE a session. The grid is shared, so a cell opened on the desktop
// appears in the phone's grid too — and if that phone connects it, the server hands the session
// over and the desktop the user is working on says "detached". Nobody did anything on the phone;
// it was in a pocket.
describe("useTerminalConnections — a hidden document does not take sessions", () => {
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release("cell-hidden");
    hide(false);
  });

  // The reclaim only reaches slots something is RENDERING, so a deferral recorded while the slot
  // was detached has nobody to clear it — and reattaching for the SAME session is neither a fresh
  // slot nor an inherited one, so nothing else would connect either. That slot stayed dead with no
  // retry armed, which on a phone is the whole session gone.
  it("connects a slot whose deferred connect is still owed after it was DETACHED", () => {
    const el = document.createElement("div");
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    // Deferred while hidden, then the view goes away before anyone looks at the document again.
    hide(true);
    conn.attach("cell-hidden", target(id), { onSession: vi.fn(), onCwd: vi.fn() }, el);
    expect(FakeWebSocket.instances).toHaveLength(0);
    conn.detach("cell-hidden", el);

    // Looking at the document cannot pay it: the reclaim only reaches slots something is
    // RENDERING, and this one is attached to nothing.
    hide(false);
    expect(FakeWebSocket.instances).toHaveLength(0);

    // So coming back to the cell has to. Same session id, so this is neither a fresh slot nor an
    // inherited one — without the deferral being consulted here, nothing would ever connect it.
    conn.attach("cell-hidden", target(id), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain(id);
  });

  it("opens no socket while hidden, and opens it when the document is looked at", () => {
    hide(true);
    conn.attach("cell-hidden", target("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(0);

    hide(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("connects immediately when the document is visible", () => {
    hide(false);
    conn.attach("cell-hidden", target("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // Hiding must not DROP a live session — that is what the persistent connections are for.
  it("leaves an already-open socket alone when the document is hidden", () => {
    conn.attach("cell-hidden", target("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const opened = FakeWebSocket.instances.at(-1);
    hide(true);
    expect(opened?.readyState).not.toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // The other half of the same rule. Without it, coming back to the desktop leaves a screenful
  // of terminals that each need a tap on "Reconnect here" — and if the user is holding the phone
  // that took them, there is no way to give them back.
  it("takes back a session another window superseded, once this document is looked at again", () => {
    conn.attach("cell-hidden", target("dddddddd-dddd-4ddd-8ddd-dddddddddddd"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const first = FakeWebSocket.instances.at(-1);
    first?.onmessage?.({ data: JSON.stringify({ type: "superseded" }) } as MessageEvent);
    expect(conn.connView.get("cell-hidden")?.status).toBe("superseded");

    hide(true);
    hide(false);
    expect(FakeWebSocket.instances).toHaveLength(2); // a new socket, at the same target
    expect(FakeWebSocket.instances.at(-1)?.url).toContain("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  });

  // A session that ENDED is not one to take back — reconnecting would spawn a new one.
  it("does not resurrect a session that exited", () => {
    conn.attach("cell-hidden", target("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 0 }) } as MessageEvent);
    hide(true);
    hide(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // The regression that shipped: a slot outlives the view that mounted it, so the map holds
  // slots nothing is rendering. One of those reclaiming "its" session takes it from the cell the
  // user is actually looking at — on the SAME device, with no second browser involved.
  it("does not let a slot nothing is rendering take a session back", () => {
    const el = document.createElement("div");
    conn.attach("cell-hidden", target("ffffffff-ffff-4fff-8fff-ffffffffffff"), { onSession: vi.fn(), onCwd: vi.fn() }, el);
    FakeWebSocket.instances.at(-1)?.onmessage?.({ data: JSON.stringify({ type: "superseded" }) } as MessageEvent);
    conn.detach("cell-hidden", el); // the cell was unmounted; the slot stays alive
    hide(true);
    hide(false);
    expect(FakeWebSocket.instances).toHaveLength(1); // nothing reconnected
  });

  // The bug this shipped with: the server sends `superseded` and then CLOSES the socket, and the
  // close handler overwrote the status a moment later. The overlay offering "Reconnect here" and
  // the reclaim-on-focus both read that status, so both were dead code for the case they exist
  // for — the user saw the banner in the terminal and nothing to act on.
  it("keeps the superseded status when the server then closes the socket", async () => {
    conn.attach("cell-hidden", target("99999999-9999-4999-8999-999999999999"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const sock = FakeWebSocket.instances.at(-1);
    sock?.onmessage?.({ data: JSON.stringify({ type: "superseded" }) } as MessageEvent);
    expect(conn.connView.get("cell-hidden")?.status).toBe("superseded");

    sock?.onclose?.();
    expect(conn.connView.get("cell-hidden")?.status).toBe("superseded"); // not overwritten
  });

  it("still reports a plain drop as disconnected", async () => {
    conn.attach("cell-hidden", target("88888888-8888-4888-8888-888888888888"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onclose?.();
    expect(conn.connView.get("cell-hidden")?.status).toBe("disconnected");
  });
});
