// The xterm-facing half of the #729 mouse-tracking swallow: the wheel (#737) and the click
// (#845) handlers that hand a swallowed app the SGR reports it asked for. The rules they apply
// (what the app wants, where the pointer is, click vs drag, the byte sequences) are pure and
// live in ./mouseReports; what is here is the wiring onto a live Terminal.
import type { Terminal } from "@xterm/xterm";
import {
  cellFromPoint,
  clearResetModes,
  clickReportSequences,
  createWheelTicker,
  flushWheelResidual,
  isClickGesture,
  recordSwallowedModes,
  TouchScrollTracker,
  wantsMouseReports,
  wheelNotches,
  wheelReportSequence,
} from "./mouseReports";
import { swallowsMouseTracking } from "./mouseTrackingModes";
import { getTerminalScrollSpeed } from "./useTerminalScrollSpeed";
import type { GridCell, PointerPosition } from "./mouseReports";

// xterm's Linkifier marks the screen element while a link is under the pointer. That click
// already has an owner (the link's activate handler), so reporting it too would fire both.
const LINK_HOVER_CLASS = "xterm-cursor-pointer";
const MAIN_BUTTON = 0;
const TOP_LEFT_CELL: GridCell = { col: 1, row: 1 };

// How long without a wheel event means the gesture is over, and the banked fraction should be
// paid out (flushWheelResidual). A trackpad's momentum tail thins out rather than stopping, so
// this is a compromise: too short flushes mid-gesture, which costs less than one line of accuracy;
// too long makes a gentle nudge feel like it was ignored, which is the bug being fixed.
export const GESTURE_END_MS = 100;

// The app hears the mouse only while it is the full-screen owner of the terminal AND asked for
// tracking it never got (#729). Both halves below answer to this one gate.
const reportsMouseToApp = (term: Terminal, swallowedMouseModes: ReadonlySet<number>): boolean =>
  term.buffer.active.type === "alternate" && wantsMouseReports(swallowedMouseModes);

const screenElementOf = (term: Terminal): HTMLElement | null => term.element?.querySelector(".xterm-screen") ?? null;

// Cells are measured off the screen element's own box, since xterm exposes no pixel-to-cell
// mapping. A terminal that isn't laid out yet reports the top-left cell rather than nothing:
// for the wheel, arriving matters more than the coordinate.
function cellUnderPointer(term: Terminal, pointer: PointerPosition): GridCell {
  const screen = screenElementOf(term);
  if (!screen) return TOP_LEFT_CELL;
  return cellFromPoint(screen.getBoundingClientRect(), term.cols, term.rows, pointer);
}

// xterm exposes no cell height, so it comes off the screen element's own box — the same
// measurement the cell mapping uses. 0 means "not laid out yet", which wheelNotches reads as
// "can't convert pixels to lines".
function cellHeightOf(term: Terminal): number {
  const screen = screenElementOf(term);
  if (!screen || term.rows <= 0) return 0;
  return screen.getBoundingClientRect().height / term.rows;
}

/** What a caller can ask of the wheel after the fact. Only one thing so far: put the app back
 *  where it was before the user scrolled — see useScrollToBottomOnSubmit for why that cannot be
 *  `term.scrollToBottom()`. */
export interface WheelScrollControl {
  restoreToBottom: () => void;
  /** Write off a scroll debt because the app that owed it is gone. The buffer transition is
   *  watched from inside, but an app can hand over WITHOUT one — `CSI ? 1003 ; 1006 l` drops
   *  tracking while the alternate buffer stays up, and the next app to ask for the mouse would
   *  otherwise be scrolled by a gesture made in the previous one (Codex on #1547). The parser
   *  handler that sees the reset calls this. */
  forgetScrollDebt: () => void;
}

// How many notches one frame of the return-to-bottom pays. The debt cannot be handed over in one
// burst: a real gesture arrives as small deltas spread over hundreds of milliseconds, and a TUI
// reading its pty gets the whole burst in ONE read and collapses it — measured against Claude
// Code, ~300 reports sent at once moved the transcript about one screenful, the same distance
// MAX_NOTCHES_PER_EVENT allows a single event (#1547). Paced, the app sees something shaped like
// a gesture and moves the whole way.
const RESTORE_NOTCHES_PER_FRAME = 4;

/** Run `fn` on the next frame, returning the canceller. Injected so a spec can drive the pacing
 *  instead of waiting for real frames. */
export type FrameScheduler = (fn: () => void) => () => void;

const onNextFrame: FrameScheduler = (fn) => {
  const id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
};

/** The scroll debt and the paced repayment of it, as one machine: `owe` records what the wheel
 *  reported, `payBack` starts handing it back a batch per frame, `stop` abandons a payout in
 *  flight and `forget` writes the debt off. Its own factory so `guardMouseWheel` stays readable —
 *  and so the rule about what a debt means lives in one place. */
function createScrollDebt(pay: (notches: number) => void, canPay: () => boolean, schedule: FrameScheduler) {
  let notches = 0;
  let cancel: (() => void) | undefined;

  const stop = (): void => {
    cancel?.();
    cancel = undefined;
  };

  const payBatch = (): void => {
    cancel = undefined;
    if (notches <= 0) return;
    // The app stopped taking reports (it exited, or left the alternate buffer) — there is nothing
    // left holding a scroll position, and reports now would be typed at whatever replaced it.
    if (!canPay()) {
      notches = 0;
      return;
    }
    pay(Math.min(RESTORE_NOTCHES_PER_FRAME, notches));
    if (notches > 0) cancel = schedule(payBatch);
  };

  return {
    /** Negative notches are wheel-UP, which takes the app further from its bottom — so the debt
     *  moves against the sign. Clamped at zero: the app stops at its own bottom, so reports past
     *  it move nothing and must not become credit that later scrolls below where the user is. */
    owe: (reported: number): void => {
      notches = Math.max(0, notches - reported);
    },
    owed: (): number => notches,
    payBack: payBatch,
    stop,
    /** Write the debt off. The app that owed it has stopped owning the screen, and nothing
     *  identifies an app — paying it into whatever starts NEXT would scroll a program that never
     *  asked (Codex on #1547). */
    forget: (): void => {
      stop();
      notches = 0;
    },
  };
}

/** The end-of-gesture flush: a timer that pays out the banked fraction once the wheel has actually
 *  stopped. Its own machine, like the debt above — a gesture worth less than a whole notch would
 *  otherwise report nothing at all, and only an agent cell takes this path, so the same nudge
 *  scrolls a shell cell fine and this one reads as broken (#1200). */
function createGestureFlush(onEnd: () => void) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  return {
    cancel,
    /** Restarted on every event, so it fires only once the gesture has stopped. */
    restart: (): void => {
      cancel();
      pending = setTimeout(() => {
        pending = undefined;
        onEnd();
      }, GESTURE_END_MS);
    },
  };
}

/** Wheel -> the SGR wheel reports the app asked for. Without this xterm converts the wheel into
 *  arrow keys for an alt-buffer app, which a TUI binds to input history — so scrolling spun the
 *  prompt history instead of the transcript (#737).
 *
 *  Deltas are accumulated into whole notches (see wheelNotches) rather than reported one per
 *  event: a macOS trackpad emits a burst per swipe, and one report each scrolled a TUI far
 *  faster than the same gesture scrolls the scrollback (#978). `scrollSpeed` is read per event,
 *  so changing it in Settings applies to terminals that are already open. */
export function guardMouseWheel(
  term: Terminal,
  swallowedMouseModes: ReadonlySet<number>,
  scrollSpeed: () => number,
  schedule: FrameScheduler = onNextFrame,
): WheelScrollControl {
  const ticker = createWheelTicker();
  let lastCell: GridCell = TOP_LEFT_CELL;

  const report = (notches: number, cell: GridCell): void => {
    const seq = wheelReportSequence(notches, cell.col, cell.row);
    if (!seq) return;
    for (let i = 0; i < Math.abs(notches); i++) term.input(seq, false);
    debt.owe(notches);
  };

  // Re-asked rather than assumed at flush time, which also settles the disposed-terminal case: a
  // terminal disposed inside the gap answers `normal` (xterm 6 keeps `buffer` readable after
  // dispose), so a timer that outlived its terminal drops the fraction instead of writing to a
  // dead one.
  const gesture = createGestureFlush(() => {
    if (!reportsMouseToApp(term, swallowedMouseModes)) {
      ticker.residual = 0;
      debt.forget();
      return;
    }
    report(flushWheelResidual(ticker), lastCell);
  });

  // `lastCell` is read at payout time, so a restore aims where the gesture did.
  const debt = createScrollDebt(
    (notches) => report(notches, lastCell),
    () => reportsMouseToApp(term, swallowedMouseModes),
    schedule,
  );

  // At the transition itself, not at the next wheel event or restore: between one app exiting and
  // the next starting there may be neither (Codex on #1547). See `forget` for why it matters.
  term.buffer.onBufferChange(() => {
    if (!reportsMouseToApp(term, swallowedMouseModes)) debt.forget();
  });

  term.attachCustomWheelEventHandler((ev) => {
    if (!reportsMouseToApp(term, swallowedMouseModes)) {
      // The bank belongs to ONE stretch of tracked scrolling. Kept across the gap, a fraction left
      // over before an app exited (or before the buffer went back to normal) would pay out on the
      // first tiny event the NEXT app sees — a scroll it didn't ask for, from a gesture that was
      // over. Nothing is lost: an unpaid fraction is by definition less than one notch.
      gesture.cancel();
      ticker.residual = 0;
      debt.forget();
      return true;
    }
    if (ev.deltaY === 0) return true;
    // The user is scrolling again, which outranks a return-to-bottom still paying itself out —
    // otherwise the two fight and the transcript jitters under the finger.
    debt.stop();
    const notches = wheelNotches(ticker, ev, cellHeightOf(term), term.rows, scrollSpeed());
    // Consumed even at zero notches: this event's motion is banked, and handing the leftover
    // back to xterm would resurrect the ↑/↓ fallback #737 exists to replace.
    ev.preventDefault();
    lastCell = cellUnderPointer(term, ev);
    report(notches, lastCell);
    // Restarted on every event, so it only fires once the gesture has actually stopped. Without it
    // a gesture worth less than one whole notch reports nothing at all, and since only an agent
    // cell takes this path, the same nudge scrolls a shell cell fine (#1200).
    gesture.restart();
    return false;
  });

  return {
    forgetScrollDebt: debt.forget,
    restoreToBottom: (): void => {
      if (debt.owed() <= 0) return;
      // The banked fraction belongs to a gesture that is over, and paying it out during the
      // restore would scroll back off the bottom by less than a notch.
      gesture.cancel();
      ticker.residual = 0;
      debt.stop(); // a restore landing mid-payout restarts it rather than running two
      debt.payBack();
    },
  };
}

// Which gestures are the app's to hear. Everything rejected here belongs to the browser side of
// the split the swallow draws: selecting text, or following a link.
function isReportableClick(term: Terminal, screen: HTMLElement, from: PointerPosition, release: MouseEvent): boolean {
  if (release.button !== MAIN_BUTTON || !isClickGesture(from, release)) return false;
  // A gesture that left a selection behind (a double-click's word, a triple-click's line) was the
  // user selecting text, not pressing the app's button — selection wins, as it does for a drag.
  return !term.hasSelection() && !screen.classList.contains(LINK_HOVER_CLASS);
}

/** Click -> the SGR press/release pair, so a TUI's own click targets ("Jump to bottom", "1 new
 *  message") respond (#845). Only a press and release that stayed put reports: a drag is still a
 *  text selection, which is what the swallow exists to protect. Nothing is preventDefault()ed,
 *  so xterm's selection is untouched.
 *
 *  Call AFTER term.open() — `term.element` does not exist before it. The listeners live on the
 *  terminal's own DOM, so they go away with it (dispose) and survive re-parenting (attach). */
export function guardMouseClicks(term: Terminal, swallowedMouseModes: ReadonlySet<number>): void {
  const screen = screenElementOf(term);
  if (!screen) return;
  let pressedAt: PointerPosition | null = null;
  const forgetPress = (): void => {
    pressedAt = null;
  };
  screen.addEventListener("mousedown", (ev) => {
    pressedAt = ev.button === MAIN_BUTTON ? { clientX: ev.clientX, clientY: ev.clientY } : null;
  });
  // Leaving settles the gesture as a drag. Without this the press stays pending, and an unrelated
  // release landing back inside would be measured against it — reporting a click that never was.
  screen.addEventListener("mouseleave", forgetPress);
  screen.addEventListener("mouseup", (ev) => {
    const from = pressedAt;
    forgetPress();
    if (!from || !isReportableClick(term, screen, from, ev)) return;
    if (!reportsMouseToApp(term, swallowedMouseModes)) return;
    const cell = cellUnderPointer(term, ev);
    clickReportSequences(cell.col, cell.row).forEach((seq) => term.input(seq, false));
  });
}

/** One-finger drag -> the same SGR wheel reports the wheel path sends. A phone has no wheel, so
 *  without this the swallowed app (Claude's transcript) cannot be scrolled at all from a touch
 *  device: the drag lands on the alternate buffer, which has no scrollback for xterm's own
 *  gesture to move.
 *
 *  Only while the app is actually being reported to. Outside that case the touch is left alone,
 *  so the normal buffer keeps xterm's gesture scrolling — and preventDefault is called ONLY when
 *  reports are being synthesized, so a plain tap still focuses the terminal and raises the soft
 *  keyboard. A second finger (a pinch) hands the gesture back to the browser.
 *
 *  `host` is the element the terminal was opened INTO, not term.element: that one is null until
 *  open(), so binding to it made the call order load-bearing — and getting it wrong attached no
 *  listeners at all, silently, which is exactly how this shipped broken the first time. The host
 *  exists before open() and the touches bubble to it, so no call order can break this. */
export function guardTouchScroll(term: Terminal, host: HTMLElement, swallowedMouseModes: ReadonlySet<number>): void {
  const tracker = new TouchScrollTracker();
  const converting = () => reportsMouseToApp(term, swallowedMouseModes);

  host.addEventListener(
    "touchstart",
    (ev) => {
      const touch = ev.touches.length === 1 ? ev.touches[0] : undefined;
      if (converting() && touch) tracker.start(touch.clientY);
      else tracker.end();
    },
    { passive: true },
  );
  host.addEventListener(
    "touchmove",
    (ev) => {
      const touch = ev.touches.length === 1 ? ev.touches[0] : undefined;
      if (!converting() || !touch) return tracker.end();
      const steps = tracker.move(touch.clientY, cellHeightOf(term));
      const seq = wheelReportSequence(steps, TOP_LEFT_CELL.col, TOP_LEFT_CELL.row);
      if (seq) for (let i = Math.abs(steps); i > 0; i--) term.input(seq, false);
      ev.preventDefault(); // the app consumes the drag — don't also rubber-band the page
    },
    { passive: false },
  );
  const stop = () => tracker.end();
  host.addEventListener("touchend", stop);
  host.addEventListener("touchcancel", stop);
}

// `opts` exists for the spec, which drives the REAL wiring rather than re-registering its own
// parser handlers — the tracking-reset path below lives here, so a harness that hand-rolled the
// handlers would not have it (Codex on #1547).
export function guardMouseTracking(
  term: Terminal,
  swallowedMouseModes: Set<number>,
  opts: { scrollSpeed?: () => number; schedule?: FrameScheduler } = {},
): WheelScrollControl {
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const swallowed = swallowsMouseTracking(params);
    if (swallowed) recordSwallowedModes(swallowedMouseModes, params);
    return swallowed;
  });
  const wheel = guardMouseWheel(term, swallowedMouseModes, opts.scrollSpeed ?? getTerminalScrollSpeed, opts.schedule);
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    clearResetModes(swallowedMouseModes, params);
    // The reset may be an app handing the terminal over without touching the buffer, which the
    // wheel guard's own buffer watch cannot see (Codex on #1547).
    if (!wantsMouseReports(swallowedMouseModes)) wheel.forgetScrollDebt();
    return false;
  });
  return wheel;
}
