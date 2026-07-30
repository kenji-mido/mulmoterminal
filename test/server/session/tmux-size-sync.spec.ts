// The rule under test is "only a size tmux CAN report and that DIFFERS earns a nudge" — anything
// looser resizes a healthy session, anything tighter leaves #957's blank screen in place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTmuxSizeSync, nudgedSize, sizesAgree, type SizeSyncEvent, type TerminalSize } from "../../../server/session/tmux-size-sync.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const SETTLE_MS = 250;
const NUDGE_MS = 50;

// How long a probe takes to answer. Zero by default (resolved promise); a test that needs to
// supersede a check WHILE it is probing gives it a duration it can advance the clock into.
const PROBE_MS = 20;

// `windows` is what tmux will claim, per call, so a test can say "wrong, then right".
function setup(windows: Array<TerminalSize | null>, probeMs = 0) {
  const resizes: TerminalSize[] = [];
  const events: SizeSyncEvent[] = [];
  const asked: string[] = [];
  let call = 0;
  const sync = createTmuxSizeSync({
    windowSizeOf: async (id) => {
      asked.push(id);
      if (probeMs > 0) await new Promise((resolve) => setTimeout(resolve, probeMs));
      return windows[Math.min(call++, windows.length - 1)] ?? null;
    },
    resizePty: (_id, size) => {
      resizes.push(size);
    },
    onEvent: (event) => events.push(event),
    settleMs: SETTLE_MS,
    nudgeMs: NUDGE_MS,
  });
  return { sync, resizes, events, asked };
}

// The check chains awaits between timers, so each has to be given its turn.
const runTimers = async (times = 6) => {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + NUDGE_MS);
  }
};

describe("sizesAgree", () => {
  it("is true only when both dimensions match", () => {
    expect(sizesAgree({ cols: 120, rows: 40 }, { cols: 120, rows: 40 })).toBe(true);
    expect(sizesAgree({ cols: 120, rows: 40 }, { cols: 120, rows: 41 })).toBe(false);
    expect(sizesAgree({ cols: 80, rows: 40 }, { cols: 120, rows: 40 })).toBe(false);
  });
});

describe("nudgedSize", () => {
  it("shrinks by a row, keeping the columns", () => {
    expect(nudgedSize({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 39 });
  });

  it("grows a one-row terminal instead, since it cannot shrink", () => {
    expect(nudgedSize({ cols: 120, rows: 1 })).toEqual({ cols: 120, rows: 2 });
  });
});

describe("createTmuxSizeSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves a session alone when tmux agrees with the client", async () => {
    const { sync, resizes, events } = setup([{ cols: 120, rows: 40 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("nudges a row off and straight back when the window disagrees", async () => {
    const { sync, resizes, events } = setup([
      { cols: 80, rows: 24 },
      { cols: 120, rows: 40 },
    ]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([
      { cols: 120, rows: 39 },
      { cols: 120, rows: 40 },
    ]);
    expect(events).toEqual([{ kind: "repairing", id: SESSION, wanted: { cols: 120, rows: 40 }, seen: { cols: 80, rows: 24 } }]);
  });

  it("says so when the window did not follow the nudge", async () => {
    // The gap then has a mechanism the measured ones don't cover — worth a line in the log
    // rather than a silent retry loop against a window that will not move.
    const { sync, events } = setup([{ cols: 80, rows: 24 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(events.map((e) => e.kind)).toEqual(["repairing", "still-wrong"]);
  });

  it("never nudges on an answer tmux could not give", async () => {
    // A dead session and a disagreeing one look the same from here; resizing on `null` would
    // fight a session that is merely gone.
    const { sync, resizes, events } = setup([null]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("probes once for a burst of resize frames, using the last size", async () => {
    // A splitter drag emits one frame per pointermove; one probe per drag is the point.
    const { sync, asked, resizes } = setup([
      { cols: 80, rows: 24 },
      { cols: 137, rows: 41 },
    ]);
    sync.requestCheck(SESSION, { cols: 100, rows: 30 });
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    sync.requestCheck(SESSION, { cols: 120, rows: 35 });
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    sync.requestCheck(SESSION, { cols: 137, rows: 41 });
    await runTimers();
    expect(asked).toHaveLength(2); // the probe, then the re-check after the nudge
    expect(resizes).toEqual([
      { cols: 137, rows: 40 },
      { cols: 137, rows: 41 },
    ]);
  });

  it("does not probe a check that was cancelled before it settled", async () => {
    const { sync, asked, resizes } = setup([{ cols: 80, rows: 24 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    sync.cancel(SESSION);
    await runTimers();
    expect(asked).toEqual([]);
    expect(resizes).toEqual([]);
  });

  it("keeps sessions apart, so one cell's burst cannot cancel another's check", async () => {
    const other = "99999999-8888-7777-6666-555555555555";
    const { sync, asked } = setup([{ cols: 120, rows: 40 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    sync.requestCheck(other, { cols: 120, rows: 40 });
    await runTimers();
    expect(asked.sort()).toEqual([SESSION, other].sort());
  });

  // A started check is SEVERAL awaits long, so clearing a timer cannot reach it. Without a ticket
  // it would resize the pty to a size the client has already moved off — recreating exactly the
  // disagreement this module exists to close (raised by Codex on #1116).
  describe("a check that has already started", () => {
    it("does nothing once a newer resize has superseded it mid-probe", async () => {
      const { sync, resizes, events } = setup([{ cols: 80, rows: 24 }], PROBE_MS);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS); // the check starts; its probe is in flight
      sync.requestCheck(SESSION, { cols: 137, rows: 41 });
      await vi.advanceTimersByTimeAsync(PROBE_MS); // the stale probe answers — too late to act on
      expect(resizes).toEqual([]);
      expect(events).toEqual([]);
    });

    it("lands the restore on the newest size when a resize arrives mid-nudge", async () => {
      // The client already set the pty to 137x41; restoring the 120x40 this check captured would
      // put the pty BEHIND the browser, which is the bug in the other direction.
      const { sync, resizes } = setup([{ cols: 80, rows: 24 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      expect(resizes).toEqual([{ cols: 120, rows: 39 }]); // shrunk, waiting to restore
      sync.requestCheck(SESSION, { cols: 137, rows: 41 });
      await vi.advanceTimersByTimeAsync(NUDGE_MS);
      expect(resizes[1]).toEqual({ cols: 137, rows: 41 });
    });

    it("hands the verification to the newer check rather than reporting on a stale size", async () => {
      const { sync, events } = setup([{ cols: 80, rows: 24 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      sync.requestCheck(SESSION, { cols: 137, rows: 41 });
      // Far enough for the superseded nudge to reach its own verification (restore + recheck, one
      // NUDGE_MS each), and short of the newer check settling — so a `still-wrong` here could only
      // come from the stale one, naming a size nobody wants.
      await vi.advanceTimersByTimeAsync(NUDGE_MS);
      await vi.advanceTimersByTimeAsync(NUDGE_MS);
      expect(NUDGE_MS * 2).toBeLessThan(SETTLE_MS);
      expect(events.map((e) => e.kind)).toEqual(["repairing"]);
    });

    it("is abandoned by a cancel, but still leaves the pty at the client's size", async () => {
      // The socket going away is no reason to leave the pty a row short of what the browser has.
      const { sync, resizes, events } = setup([{ cols: 80, rows: 24 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      sync.cancel(SESSION);
      await runTimers();
      expect(resizes).toEqual([
        { cols: 120, rows: 39 },
        { cols: 120, rows: 40 },
      ]);
      expect(events.map((e) => e.kind)).toEqual(["repairing"]);
    });

    it("cannot be revived by a ticket number a later request reuses", async () => {
      // Tickets are counted across the whole process, so no number is ever handed out twice —
      // not after a cancel, and not after the session's state has been forgotten entirely.
      const { sync, events } = setup([{ cols: 80, rows: 24 }], PROBE_MS);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      sync.cancel(SESSION);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(PROBE_MS);
      expect(events).toEqual([]); // the abandoned check acted on nothing
    });

    it("does not report `still-wrong` for a size superseded during the verification", async () => {
      // Two awaits separate the ownership check from the report. `still-wrong` means "the repair
      // itself failed" — a false one sends the next investigator after a mechanism that isn't
      // there, which is the opposite of what the logging is for.
      const { sync, events } = setup([{ cols: 80, rows: 24 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS); // shrink
      await vi.advanceTimersByTimeAsync(NUDGE_MS); // restore, then start verifying
      sync.requestCheck(SESSION, { cols: 137, rows: 41 }); // lands mid-verification
      await vi.advanceTimersByTimeAsync(NUDGE_MS); // the stale probe answers 80x24
      expect(events.map((e) => e.kind)).toEqual(["repairing"]);
    });

    it("cannot be revived by a session id that comes back after being forgotten", async () => {
      // `--resume` brings an id back after a reap, so `forget` must not reopen the door either.
      const { sync, events } = setup([{ cols: 80, rows: 24 }], PROBE_MS);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      sync.forget(SESSION);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await vi.advanceTimersByTimeAsync(PROBE_MS);
      expect(events).toEqual([]);
    });
  });

  // Measured on a real spawn: a tmux server whose status line was still on sat at window 137x40
  // against a 137x41 client, and the nudge could not move it — the bar reserves a row, so the two
  // can never be equal. Retrying that every resize would double-resize the app and repeat the
  // warning for the session's whole life, drowning the signal this logging exists to give.
  describe("a gap the nudge cannot close", () => {
    const CLIENT = { cols: 137, rows: 41 };
    const STUCK = { cols: 137, rows: 40 };

    it("is reported once, then left alone", async () => {
      const { sync, events, resizes } = setup([STUCK]);
      sync.requestCheck(SESSION, CLIENT);
      await runTimers();
      expect(events.map((e) => e.kind)).toEqual(["repairing", "still-wrong"]);
      const afterFirst = resizes.length;

      sync.requestCheck(SESSION, CLIENT);
      await runTimers();
      expect(events.map((e) => e.kind)).toEqual(["repairing", "still-wrong"]); // nothing new
      expect(resizes).toHaveLength(afterFirst); // and the app was not resized again
    });

    it("is tried again when the client asks for a different size", async () => {
      // A new geometry is a new question — the old answer says nothing about it.
      const { sync, events } = setup([STUCK]);
      sync.requestCheck(SESSION, CLIENT);
      await runTimers();
      sync.requestCheck(SESSION, { cols: 100, rows: 30 });
      await runTimers();
      expect(events.filter((e) => e.kind === "repairing")).toHaveLength(2);
    });

    it("is news again once the window has caught up in between", async () => {
      const { sync, events } = setup([STUCK, STUCK, CLIENT, STUCK, CLIENT]);
      sync.requestCheck(SESSION, CLIENT);
      await runTimers(); // probe -> STUCK, nudge, recheck -> STUCK: reported and remembered
      sync.requestCheck(SESSION, CLIENT);
      await runTimers(); // probe -> CLIENT: in step, so the memory is dropped
      sync.requestCheck(SESSION, CLIENT);
      await runTimers(); // probe -> STUCK again: worth reporting
      expect(events.filter((e) => e.kind === "repairing")).toHaveLength(2);
    });
  });

  // `handleClientClose` cancels for EVERY session, tmux or not — so a cancel that allocated would
  // leak an entry per disconnect for the server's whole life (raised by Codex on #1116).
  describe("per-session state", () => {
    it("allocates nothing for a session that never had a check", () => {
      const { sync } = setup([{ cols: 120, rows: 40 }]);
      sync.cancel("a-session-with-no-tmux-and-no-check");
      sync.cancel("another-one");
      expect(sync.trackedSessionCount()).toBe(0);
    });

    it("keeps a cancelled session's state, because a detached session can reattach", async () => {
      const { sync } = setup([{ cols: 120, rows: 40 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      sync.cancel(SESSION);
      await runTimers();
      expect(sync.trackedSessionCount()).toBe(1);
    });

    it("frees it when the session is forgotten", async () => {
      const { sync } = setup([{ cols: 120, rows: 40 }]);
      sync.requestCheck(SESSION, { cols: 120, rows: 40 });
      await runTimers();
      sync.forget(SESSION);
      expect(sync.trackedSessionCount()).toBe(0);
    });

    it("holds one entry per session, however many resize frames arrive", async () => {
      const { sync } = setup([{ cols: 120, rows: 40 }]);
      for (let i = 0; i < 50; i++) sync.requestCheck(SESSION, { cols: 120, rows: 40 + i });
      await runTimers();
      expect(sync.trackedSessionCount()).toBe(1);
    });
  });
});
