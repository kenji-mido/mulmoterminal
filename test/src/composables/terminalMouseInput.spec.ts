// The pure rules have their own spec; what is pinned here is the wiring that actually makes a
// TUI's click targets work (#845): the REAL guardMouseClicks on a REAL xterm, with the #729
// tracking swallow in place, turning a click on the screen element into the SGR report the app
// asked for — and staying quiet in every case the swallow exists to protect. Asserting the rules
// alone would pass just as happily with the listeners on the wrong element or the wrong gate.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { Terminal } from "@xterm/xterm";
// guardMouseWheel and guardTouchScroll are read by the fork's touch-scroll tests at the bottom of
// this file; the rest is upstream's wheel-control surface.
import {
  GESTURE_END_MS,
  guardMouseClicks,
  guardMouseTracking,
  guardTouchScroll,
  type FrameScheduler,
  type WheelScrollControl,
} from "../../../src/composables/terminalMouseInput";
import { recordSwallowedModes } from "../../../src/composables/mouseReports";
import { swallowsMouseTracking } from "../../../src/composables/mouseTrackingModes";

// xterm's Terminal.open() reaches for browser APIs jsdom omits; stub the few it needs.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const COLS = 80;
const ROWS = 24;
const CELL_WIDTH_PX = 10;
const CELL_HEIGHT_PX = 20;
const LINK_HOVER_CLASS = "xterm-cursor-pointer";
const SECONDARY_BUTTON = 2;
const ALT_BUFFER_ON = "\x1b[?1049h";
const ALT_BUFFER_OFF = "\x1b[?1049l";
const CLAUDE_TRACKING_REQUEST = "\x1b[?1002;1006h";

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

const openTerminals: Terminal[] = [];

interface Wired {
  term: Terminal;
  screen: HTMLElement;
  sent: string[];
  wheel: WheelScrollControl;
}

// A terminal wired the way ensure() wires one: the #729 parser swallow, then the click guard
// after open(). jsdom lays nothing out, so the screen element is given the grid's real geometry.
const syncFrames: FrameScheduler = (fn) => {
  fn();
  return () => {};
};

async function openWiredTerminal(options: { tracked?: boolean; scrollSpeed?: number; schedule?: FrameScheduler } = {}): Promise<Wired> {
  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  openTerminals.push(term);
  const swallowedMouseModes = new Set<number>();
  // The REAL wiring, not a copy of it: guardMouseTracking owns the parser handlers, and the
  // tracking-RESET path lives in the one this harness used to omit (Codex on #1547).
  const wheelControl = guardMouseTracking(term, swallowedMouseModes, {
    scrollSpeed: () => options.scrollSpeed ?? 1,
    schedule: options.schedule ?? syncFrames,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  term.open(host);
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) throw new Error("xterm did not create .xterm-screen — the click guard has nothing to bind to");
  screen.getBoundingClientRect = () => new DOMRect(0, 0, COLS * CELL_WIDTH_PX, ROWS * CELL_HEIGHT_PX);
  guardMouseClicks(term, swallowedMouseModes);
  guardTouchScroll(term, host, swallowedMouseModes);
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  await write(term, ALT_BUFFER_ON);
  if (options.tracked !== false) await write(term, CLAUDE_TRACKING_REQUEST);
  return { term, screen, sent, wheel: wheelControl };
}

const mouse = (screen: HTMLElement, type: "mousedown" | "mouseup", clientX: number, clientY: number, button = 0) =>
  screen.dispatchEvent(new MouseEvent(type, { clientX, clientY, button, bubbles: true }));

const click = (screen: HTMLElement, clientX: number, clientY: number) => {
  mouse(screen, "mousedown", clientX, clientY);
  mouse(screen, "mouseup", clientX, clientY);
};

// A one-finger drag, as a phone delivers it. `element` (not the screen) is what the touch guard
// binds to, so these go through the same element a real finger would land on.
const touch = (term: Terminal, type: "touchstart" | "touchmove" | "touchend", ys: number[]): boolean => {
  const touches = ys.map((clientY) => ({ clientY, clientX: 0 }) as Touch);
  const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent & { touches: Touch[] };
  Object.defineProperty(ev, "touches", { value: touches });
  const host = term.element;
  if (!host) throw new Error("the terminal has no element — the touch guard has nothing to bind to");
  return host.dispatchEvent(ev);
};

afterEach(() => {
  openTerminals.splice(0).forEach((term) => term.dispose());
  document.body.replaceChildren();
});

describe("guardMouseClicks on a real terminal", () => {
  // The premise of the whole fix: xterm itself sends nothing, because #729 dropped the SET.
  it("leaves xterm out of mouse mode, so any report can only be ours", async () => {
    const { term } = await openWiredTerminal();
    expect(term.modes.mouseTrackingMode).toBe("none");
  });

  it("sends a press/release pair for the clicked cell", async () => {
    const { screen, sent } = await openWiredTerminal();
    click(screen, 115, 250); // 115px / 10px + 1 = col 12; 250px / 20px + 1 = row 13
    expect(sent).toEqual(["\x1b[<0;12;13M", "\x1b[<0;12;13m"]);
  });

  it("stays silent for a drag — that is a text selection (#729)", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250);
    mouse(screen, "mouseup", 315, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent while a link is under the pointer — the link owns that click", async () => {
    const { screen, sent } = await openWiredTerminal();
    screen.classList.add(LINK_HOVER_CLASS);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent in the normal buffer, where the pointer belongs to xterm", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, ALT_BUFFER_OFF);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent for an app that never asked for tracking", async () => {
    const { screen, sent } = await openWiredTerminal({ tracked: false });
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  it("stays silent for a secondary button", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250, SECONDARY_BUTTON);
    mouse(screen, "mouseup", 115, 250, SECONDARY_BUTTON);
    expect(sent).toEqual([]);
  });

  // A press that left the element is a drag, and the browser delivers its release elsewhere. The
  // press must not stay pending: the next release to land inside would be measured against it.
  it("forgets a press once the pointer leaves, so a later release reports nothing", async () => {
    const { screen, sent } = await openWiredTerminal();
    mouse(screen, "mousedown", 115, 250);
    screen.dispatchEvent(new MouseEvent("mouseleave"));
    mouse(screen, "mouseup", 115, 250);
    expect(sent).toEqual([]);
  });

  // xterm selects a word on double-click; that gesture is the user selecting text, not pressing
  // the app's button. (The first click of the pair reports — nothing is selected yet.)
  it("stays silent for a click that left a selection behind", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, "hello world");
    term.selectLines(0, 0);
    expect(term.hasSelection()).toBe(true);
    click(screen, 115, 250);
    expect(sent).toEqual([]);
  });

  // The plain-click case above must not be silently riding on this same guard.
  it("leaves no selection behind for a plain click", async () => {
    const { term, screen } = await openWiredTerminal();
    click(screen, 115, 250);
    expect(term.hasSelection()).toBe(false);
  });
});

describe("guardMouseWheel on a real terminal", () => {
  // A wheel event's deltaY is in PIXELS by default (deltaMode 0), which is what both a trackpad
  // and a macOS wheel mouse send. One cell is CELL_HEIGHT_PX tall, so 120px is 6 lines.
  const wheel = (screen: HTMLElement, deltaY: number, clientX: number, clientY: number) =>
    screen.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));

  it("reports the wheel at the cell under the pointer, not a fixed 1;1", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 120, 115, 250); // 115px / 10px + 1 = col 12; 250px / 20px + 1 = row 13
    expect(new Set(sent)).toEqual(new Set(["\x1b[<65;12;13M"]));
  });

  it("encodes direction: up is button 64, down is 65", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, -120, 5, 10);
    expect(new Set(sent)).toEqual(new Set(["\x1b[<64;1;1M"]));
  });

  // The rate itself, which is the whole of #978: a 120px event is 6 cells of movement, so it is
  // worth 6 notches — the same distance xterm's own scrollback would have travelled.
  it("reports one notch per cell of movement, not one per event", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 120, 115, 250);
    expect(sent).toHaveLength(6);
  });

  // The regression #978 is actually about: a macOS trackpad emits a burst of tiny deltas per
  // swipe. One report each meant a nudge scrolled a TUI dozens of lines.
  it("banks a burst of tiny trackpad deltas instead of reporting each one", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250); // 2px: 0.15 notches each
    expect(sent).toEqual([]);
  });

  // Banked, not discarded — the swipe still has to arrive, just at the speed of the gesture.
  it("pays out the banked fraction once it adds up to a whole notch", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 20; i++) wheel(screen, 2, 115, 250); // 20 x 0.15 = 3 notches
    expect(sent).toEqual(["\x1b[<65;12;13M", "\x1b[<65;12;13M", "\x1b[<65;12;13M"]);
  });

  // The banked motion must not leak back to xterm: its alt-buffer fallback is the ↑/↓ conversion
  // #737 exists to replace, so an event worth less than a notch has to be consumed, not deferred.
  it("consumes an event too small to report rather than letting the arrow fallback have it", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 2, 115, 250);
    expect(sent).toEqual([]);
  });

  it("drops the banked fraction when the swipe reverses, so the flick back doesn't overshoot", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250); // 0.75 notches banked downwards
    wheel(screen, -4, 115, 250); // 0.3 notches up — nothing owed, the 0.75 is not credit
    expect(sent).toEqual([]);
  });

  it("scales with the user's scroll speed", async () => {
    const half = await openWiredTerminal({ scrollSpeed: 0.5 });
    wheel(half.screen, 120, 115, 250);
    expect(half.sent).toHaveLength(3);
    const double = await openWiredTerminal({ scrollSpeed: 2 });
    wheel(double.screen, 120, 115, 250);
    expect(double.sent).toHaveLength(12);
  });

  it("stays silent in the normal buffer, where the wheel is xterm's own scrollback", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    await write(term, ALT_BUFFER_OFF);
    wheel(screen, 120, 115, 250);
    expect(sent).toEqual([]);
  });

  // The bank is scoped to one stretch of tracked scrolling. A fraction left over when the app quit
  // (or the buffer went back to normal) must not sit there and pay out on the first tiny event the
  // NEXT app sees — that app would scroll from a gesture that ended before it started.
  it("forgets the banked fraction across a trip through the normal buffer", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 6; i++) wheel(screen, 2, 115, 250); // 0.9 notches banked, none paid
    expect(sent).toEqual([]);
    await write(term, ALT_BUFFER_OFF);
    wheel(screen, 2, 115, 250); // in the normal buffer: xterm's, and it empties the bank
    await write(term, ALT_BUFFER_ON);
    wheel(screen, 2, 115, 250); // 0.15 notches — on a stale 0.9 bank this would report
    expect(sent).toEqual([]);
  });

  // Not silence but deference: for an app that asked for nothing, xterm's own alt-buffer fallback
  // turns the wheel into ↓. That fallback is exactly what #737 is about — a TUI binds the arrows
  // to input history, so scrolling spun the prompt. It is only tolerable for an app that never
  // asked for the mouse; the case above shows the report replacing it for one that did.
  it("leaves xterm's arrow-key fallback alone for an app that never asked for tracking", async () => {
    const { screen, sent } = await openWiredTerminal({ tracked: false });
    wheel(screen, 120, 115, 250);
    expect(sent).toEqual(["\x1b[B"]);
  });
});

// The wheel path's counterpart for a device that has no wheel. Without it the alternate buffer —
// which has no scrollback for xterm's own gesture to move — simply cannot be scrolled by hand.
describe("guardTouchScroll on a real terminal", () => {
  it("converts a one-finger drag into the SGR wheel reports the app asked for", async () => {
    const { term, sent } = await openWiredTerminal();
    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 - CELL_HEIGHT_PX * 2]); // two lines up = two wheel-down reports
    expect(sent).toEqual(["\x1b[<65;1;1M", "\x1b[<65;1;1M"]);
  });

  it("drags the other way to scroll back up", async () => {
    const { term, sent } = await openWiredTerminal();
    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 + CELL_HEIGHT_PX]);
    expect(sent).toEqual(["\x1b[<64;1;1M"]);
  });

  it("says nothing until the drag has covered a whole line", async () => {
    const { term, sent } = await openWiredTerminal();
    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 - 3]);
    expect(sent).toEqual([]);
  });

  // The gate: an app that never asked for tracking keeps xterm's own gesture scrolling, and a
  // tap that reports nothing must stay a tap — preventDefault there would cost the soft keyboard.
  it("stays out of the way when the app did not ask for mouse reports", async () => {
    const { term, sent } = await openWiredTerminal({ tracked: false });
    touch(term, "touchstart", [300]);
    const notPrevented = touch(term, "touchmove", [300 - CELL_HEIGHT_PX * 2]);
    expect(sent).toEqual([]);
    expect(notPrevented).toBe(true);
  });

  it("hands a two-finger gesture (a pinch) back to the browser", async () => {
    const { term, sent } = await openWiredTerminal();
    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 - CELL_HEIGHT_PX * 2, 400]);
    expect(sent).toEqual([]);
  });

  // A move that arrives after the finger left — no touchstart of its own — belongs to no drag.
  // Without touchend clearing the tracker it would keep scrolling from the stale position.
  it("stops converting once the drag has ended", async () => {
    const { term, sent } = await openWiredTerminal();
    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 - CELL_HEIGHT_PX]);
    expect(sent).toHaveLength(1);
    touch(term, "touchend", []);
    touch(term, "touchmove", [300 - CELL_HEIGHT_PX * 5]);
    expect(sent).toHaveLength(1); // still just the one from the real drag
  });

  // The bug this shipped with: bound to term.element, the guard attached NOTHING when wired
  // before open() — silently, because there was no element yet to complain about. Taking the
  // host removes the ordering trap, and this is the assertion that says so.
  it("works even when wired before the terminal is opened", async () => {
    const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    openTerminals.push(term);
    const swallowedMouseModes = new Set<number>();
    term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      const swallowed = swallowsMouseTracking(params);
      if (swallowed) recordSwallowedModes(swallowedMouseModes, params);
      return swallowed;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    guardTouchScroll(term, host, swallowedMouseModes); // BEFORE open, as the real wiring did
    term.open(host);
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (screen) screen.getBoundingClientRect = () => new DOMRect(0, 0, COLS * CELL_WIDTH_PX, ROWS * CELL_HEIGHT_PX);
    const sent: string[] = [];
    term.onData((data) => sent.push(data));
    await write(term, ALT_BUFFER_ON);
    await write(term, CLAUDE_TRACKING_REQUEST);

    touch(term, "touchstart", [300]);
    touch(term, "touchmove", [300 - CELL_HEIGHT_PX]);
    expect(sent).toEqual(["\x1b[<65;1;1M"]);
  });
});

// Banking is right for a gesture that keeps going, and leaves a hole for one that stops short: the
// sub-notch events are consumed and report nothing, so a gentle nudge does NOTHING — while the same
// nudge scrolls a shell cell fine, because only an agent cell takes this path (#1200). The end of
// the gesture is when the leftover has to be paid, and only a timer can tell the difference between
// "stopped" and "still going".
//
// Real timers, not fake ones: xterm's own `write` callback is scheduled on a timer too, so faking
// them here hangs the terminal setup these tests need. GESTURE_END_MS is 100ms, which is cheap
// enough to actually wait out.
describe("guardMouseWheel gesture-end flush", () => {
  const wheel = (screen: HTMLElement, deltaY: number, clientX: number, clientY: number) =>
    screen.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // A margin over the gap, so a loaded runner cannot make "the gesture ended" arrive late.
  const afterGesture = () => sleep(GESTURE_END_MS * 3);
  // Comfortably inside the gap, so the gesture still counts as going.
  const midGesture = () => sleep(GESTURE_END_MS / 4);

  it("pays a nudge that never reached a whole notch, once it stops", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250); // 0.75 of a notch
    expect(sent).toEqual([]);
    await afterGesture();
    expect(sent).toEqual(["\x1b[<65;12;13M"]);
  });

  // At the cell the gesture ended over, not a fixed 1;1 — the flush has no event of its own.
  it("reports the flush at the last cell the pointer was over", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 4; i++) wheel(screen, -2, 5, 10); // col 1, row 1
    wheel(screen, -2, 115, 250); // then col 12, row 13
    await afterGesture();
    expect(sent).toEqual(["\x1b[<64;12;13M"]);
  });

  // Restarted per event, so a swipe still in progress is never cut short.
  it("does not fire while the gesture is still going", async () => {
    const { screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 4; i++) {
      wheel(screen, 2, 115, 250);
      await midGesture();
    }
    expect(sent).toEqual([]);
  });

  it("pays nothing for a stray pixel", async () => {
    const { screen, sent } = await openWiredTerminal();
    wheel(screen, 2, 115, 250); // 0.15 of a notch
    await afterGesture();
    expect(sent).toEqual([]);
  });

  // The bank is scoped to one stretch of TRACKED scrolling, so a gesture interrupted by the app
  // leaving the alternate buffer owes nothing — the same rule the reset in the handler keeps.
  it("pays nothing once the app has stopped taking the mouse", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250);
    await write(term, ALT_BUFFER_OFF);
    await afterGesture();
    expect(sent).toEqual([]);
  });

  // Nothing removes a pending timer when the terminal goes away, so the flush has to survive one
  // firing after dispose. xterm keeps `buffer` readable there, which the gate reads as `normal`.
  it("does nothing when the terminal was disposed inside the gap", async () => {
    const { term, screen, sent } = await openWiredTerminal();
    for (let i = 0; i < 5; i++) wheel(screen, 2, 115, 250);
    term.dispose();
    await afterGesture();
    expect(sent).toEqual([]);
  });
});

// Returning a scrolled-up agent to the bottom when the user submits (#1546).
//
// A shell cell has always done this: no mouse tracking, so the wheel puts tmux into copy-mode and
// Enter is copy-mode's own cancel. A full-screen agent takes the wheel itself — Claude Code sets
// tracking 1003 AND the alternate buffer, measured with `tmux list-panes` — so the scroll position
// belongs to the AGENT and there is no xterm scrollback to return to. What this side can do is
// unwind the notches it reported, because it is the side that synthesized them.
describe("restoreToBottom on a real terminal", () => {
  const wheel = (screen: HTMLElement, deltaY: number) =>
    screen.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: 115, clientY: 250, bubbles: true, cancelable: true }));
  // 120px / 20px per cell = 6 notches at the default speed. Deltas are kept at this WHEEL size
  // throughout: a small delta is read as a trackpad and gained, so a fraction of it is not a
  // proportional fraction of the notches (see TRACKPAD_GAIN in mouseReports).
  const SIX_NOTCHES_PX = 120;
  const downReports = (sent: string[]) => sent.filter((s) => s.startsWith("\x1b[<65;"));
  const upReports = (sent: string[]) => sent.filter((s) => s.startsWith("\x1b[<64;"));

  it("sends nothing when the user has not scrolled", async () => {
    const { sent, wheel: control } = await openWiredTerminal();
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });

  it("unwinds exactly the notches it scrolled the app up by", async () => {
    const { screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    expect(upReports(sent)).toHaveLength(6);
    sent.length = 0;
    control.restoreToBottom();
    expect(downReports(sent)).toHaveLength(6);
  });

  it("counts a scroll back down against the debt", async () => {
    const { screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    wheel(screen, -SIX_NOTCHES_PX); // twelve notches up in total
    wheel(screen, SIX_NOTCHES_PX); // the user came six of them back themselves
    sent.length = 0;
    control.restoreToBottom();
    expect(downReports(sent)).toHaveLength(6);
  });

  // The app stops at its own bottom, so reports past it move nothing. Going into credit would make
  // a later restore scroll DOWN past where the user actually is.
  it("does not go into credit when scrolled further down than up", async () => {
    const { screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    wheel(screen, SIX_NOTCHES_PX);
    wheel(screen, SIX_NOTCHES_PX); // far more down than up
    sent.length = 0;
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });

  it("is spent once — a second restore sends nothing", async () => {
    const { screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    control.restoreToBottom();
    sent.length = 0;
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });

  // The app exited or left the alternate buffer: reports now would be typed at whatever replaced
  // it, and there is no scroll position left to restore. The debt is forgotten, not paid — and it
  // stays forgotten if a new app takes the terminal, which never asked to be scrolled.
  it("forgets the debt when the app has stopped taking the mouse", async () => {
    const { term, screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    await write(term, ALT_BUFFER_OFF);
    sent.length = 0;
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });

  // Why the payout is paced at all. A real gesture reaches the app as small deltas over hundreds of
  // milliseconds; the whole debt handed over in one tick arrives as a single pty read, and a TUI
  // collapses that — measured against Claude Code, the transcript moved about one screenful however
  // far the user had scrolled (#1547). So one frame must carry a gesture-sized batch, not the lot.
  it("pays the debt a few notches per frame, not in one burst", async () => {
    const frames: (() => void)[] = [];
    const manualFrames: FrameScheduler = (fn) => {
      frames.push(fn);
      return () => {};
    };
    const { screen, sent, wheel: control } = await openWiredTerminal({ schedule: manualFrames });
    wheel(screen, -SIX_NOTCHES_PX * 4); // 24 notches up
    sent.length = 0;
    control.restoreToBottom();
    const firstBatch = downReports(sent).length;
    expect(firstBatch).toBeGreaterThan(0);
    expect(firstBatch).toBeLessThan(24); // paced, not the whole debt at once
    // Driving the frames it asked for pays the rest, and it stops asking once the debt is clear.
    while (frames.length > 0) frames.shift()?.();
    expect(downReports(sent)).toHaveLength(24);
  });

  // The other handover, and the one the buffer watch cannot see: an app drops tracking while the
  // alternate buffer stays up. The next app to ask for the mouse must not be scrolled by a gesture
  // made in the previous one (Codex on #1547).
  it("does not replay the debt after a tracking reset with no buffer switch", async () => {
    const { term, screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    await write(term, "\x1b[?1002;1006l"); // tracking off, alternate buffer still up
    await write(term, CLAUDE_TRACKING_REQUEST); // and the next app asks for the mouse
    sent.length = 0;
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });

  // The debt belongs to the app that was scrolled, and nothing identifies an app. If it survives
  // one exiting, the NEXT full-screen app is scrolled by a gesture made in the previous one — and
  // between the two there may be no restore and no wheel event to notice the gap, so the clearing
  // has to happen at the transition itself (Codex on #1547).
  it("does not replay one app's debt into the next app that takes the mouse", async () => {
    const { term, screen, sent, wheel: control } = await openWiredTerminal();
    wheel(screen, -SIX_NOTCHES_PX);
    await write(term, ALT_BUFFER_OFF); // the app exits — nothing else happens in between
    await write(term, ALT_BUFFER_ON); // and the next one starts
    await write(term, CLAUDE_TRACKING_REQUEST);
    sent.length = 0;
    control.restoreToBottom();
    expect(sent).toEqual([]);
  });
});
