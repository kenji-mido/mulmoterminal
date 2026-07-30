import { describe, it, expect, vi, afterEach } from "vitest";
import { startRateLimitProbe, PROBE_PROMPT } from "./rate-limit-probe";
import { createRateLimitStore } from "./rate-limit-store";

const CR = "\r";
const ESC_CR = "\x1b\r";
// Past BOOT_MS + TYPE_TO_SUBMIT_MS (4000 + 800), well short of PROBE_TIMEOUT_MS.
const PAST_SUBMIT_MS = 5000;

const deps = (over: Partial<Parameters<typeof startRateLimitProbe>[0]> = {}) => ({
  spawn: () => ({ write: () => {}, kill: () => {} }),
  host: "localhost",
  port: 34567,
  cwd: "/tmp",
  sessionId: "s",
  onSettled: () => {},
  submitSequence: () => CR,
  ...over,
});

describe("startRateLimitProbe", () => {
  // The caller marks a probe in flight BEFORE calling this, so an escape here would leave that flag
  // set with nothing to clear it and the gauge would stop refreshing for the life of the process.
  // Every failure has to arrive as the ordinary "this probe reported nothing".
  it("reports settled instead of throwing when the spawn fails", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(
      deps({
        onSettled,
        spawn: () => {
          throw new Error("claude is not installed");
        },
      }),
    );
    expect(onSettled).toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  // Which is what a missing `claude` looks like from here — no branch of its own, because there is
  // nothing different to do about it.
  it("settles exactly once even when stopped again", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(deps({ onSettled }));
    stop();
    stop();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("kills the terminal it started when stopped", () => {
    const kill = vi.fn();
    const stop = startRateLimitProbe(deps({ spawn: () => ({ write: () => {}, kill }) }));
    stop();
    expect(kill).toHaveBeenCalled();
  });

  // A PTY that has already exited makes kill() throw; stopping must still settle.
  it("still settles when killing throws", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(
      deps({
        onSettled,
        spawn: () => ({
          write: () => {},
          kill: () => {
            throw new Error("already gone");
          },
        }),
      }),
    );
    expect(() => stop()).not.toThrow();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

// The probe drives a real `claude` TUI, so it has to submit the way THAT host's Claude submits: on
// an `esc-cr` host a bare CR is the newline, and the question would be typed but never asked — the
// probe could then only time out, leaving the gauge stale with nothing on screen to say why (#1148).
describe("submitting the probe's question", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const askWith = (submitSequence: () => string) => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const stop = startRateLimitProbe(deps({ spawn: () => ({ write: (data: string) => writes.push(data), kill: () => {} }), submitSequence }));
    vi.advanceTimersByTime(PAST_SUBMIT_MS);
    stop();
    return writes;
  };

  it("submits with the host's ESC+CR", () => {
    expect(askWith(() => ESC_CR)).toEqual([PROBE_PROMPT, ESC_CR]);
  });

  it("submits with a plain CR on a default host", () => {
    expect(askWith(() => CR)).toEqual([PROBE_PROMPT, CR]);
  });

  // Read per probe, so a `terminalSubmit` edit applies to the next refresh without a restart.
  it("resolves the sequence when it submits, not when the probe starts", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let mode = CR;
    const stop = startRateLimitProbe(deps({ spawn: () => ({ write: (data: string) => writes.push(data), kill: () => {} }), submitSequence: () => mode }));
    mode = ESC_CR;
    vi.advanceTimersByTime(PAST_SUBMIT_MS);
    stop();
    expect(writes[1]).toBe(ESC_CR);
  });

  it("neither types nor submits once the probe has been stopped", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const stop = startRateLimitProbe(deps({ spawn: () => ({ write: (data: string) => writes.push(data), kill: () => {} }), submitSequence: () => ESC_CR }));
    stop();
    vi.advanceTimersByTime(PAST_SUBMIT_MS);
    expect(writes).toEqual([]);
  });
});

// How index.ts wires the two together: the store says which agent reported windows, and that is
// what ends the probe. Composed here rather than asserted on index.ts, because the bug was in the
// composition — `startRateLimitProbe`'s return value was simply dropped, so the PTY was held for
// the full 90-second timeout after the answer had already arrived, and `probing: true` kept every
// browser polling at seconds for the whole of it.
describe("ending the probe when its answer lands", () => {
  const windows = { fiveHour: { usedPercentage: 12, resetsAt_sec: 999 }, sevenDay: null };

  const wire = () => {
    const killed = vi.fn();
    const onSettled = vi.fn();
    let stop: (() => void) | null = null;
    const store = createRateLimitStore({}, (_snapshot, agent) => {
      if (agent === "claude") stop?.();
    });
    stop = startRateLimitProbe(
      deps({
        onSettled: () => {
          stop = null;
          onSettled();
        },
        spawn: () => ({ write: () => {}, kill: killed }),
      }),
    );
    return { store, killed, onSettled };
  };

  it("stops as soon as a Claude report carries windows", () => {
    const { store, killed, onSettled } = wire();
    store.report("claude", windows, 1000);
    expect(killed).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  // The status line also fires before the session's first API response, when `rate_limits` is not
  // there yet (statusline.ts). Ending on that would kill the probe just short of the one thing it
  // was spawned to collect.
  it("keeps going for a status line that carried none", () => {
    const { store, killed } = wire();
    store.report("claude", null, 1000);
    expect(killed).not.toHaveBeenCalled();
  });

  // Codex is read from a file on every poll; it has nothing to do with this probe's lifetime.
  it("is not ended by a Codex reading", () => {
    const { store, killed } = wire();
    store.report("codex", windows, 1000);
    expect(killed).not.toHaveBeenCalled();
  });
});
