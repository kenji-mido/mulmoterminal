import { describe, it, expect, vi, beforeEach } from "vitest";

import { useSessionStop, stopSessionPrompt } from "../../../src/composables/useSessionStop";

// The two rules the component cannot show on its own: a stop that FAILS still re-reads the list,
// and a second click while one is in flight fires nothing (#1467).
const row = (over: Partial<{ id: string; title: string; runningKey: string | null }> = {}) => ({
  id: "s-9",
  title: "fix the parser",
  runningKey: "s-9",
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

describe("useSessionStop", () => {
  it("terminates the running key and then reloads", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reload = vi.fn();
    const { stopSession } = useSessionStop(reload);
    await stopSession(row({ runningKey: "mt-key-2" }));
    expect(String((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe("/api/session/mt-key-2/terminate");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("asks first, and does nothing when the answer is no", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const reload = vi.fn();
    const { stopSession } = useSessionStop(reload);
    await stopSession(row());
    expect(confirm).toHaveBeenCalledWith(stopSessionPrompt("fix the parser"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing for a row with nothing running, without asking", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { stopSession } = useSessionStop(vi.fn());
    await stopSession(row({ runningKey: null }));
    await stopSession({ id: "s-9", title: "no field at all" });
    expect(confirm).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // A terminate that fails leaves the session running, and the row must go back to saying so —
  // which only the reload can decide. Swallowing the error without it would leave the button
  // pointing at a session whose state nobody re-read.
  it("reloads even when the request fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const reload = vi.fn();
    const { stopSession, stopping } = useSessionStop(reload);
    await stopSession(row());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stopping.value).toBeNull();
  });

  // Two clicks on a slow stop must not send two terminates — the second would be aimed at a key
  // the first is already killing, and the confirmation would be asked twice for one action.
  it("ignores a second stop while one is in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let release = (): void => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({}) } as unknown as Response);
        }),
    ) as unknown as typeof fetch;
    const { stopSession, stopping } = useSessionStop(vi.fn());
    const first = stopSession(row());
    expect(stopping.value).toBe("s-9");
    await stopSession(row({ id: "s-other", runningKey: "s-other" }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(stopping.value).toBeNull();
  });
});
