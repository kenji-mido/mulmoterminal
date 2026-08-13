// @vitest-environment node
// Before #823 a dropped command channel left one line in the server log and nothing else,
// so the first sign was the phone failing to connect. These pin the bell entry that now
// says so — and, just as importantly, that a self-healed blip does NOT raise one.
import { describe, it, expect, vi } from "vitest";
import { createHealthNotice, type HealthNoticeDeps } from "../../../../server/backends/remoteHost/healthNotice";
import type { RunnerHealth, RunnerHealthState } from "../../../../common/remoteHostHealth";

type Publish = HealthNoticeDeps["publish"];

const health = (state: RunnerHealthState, lastError: string | null = null): RunnerHealth => ({ state, lastError, changedAt: 1 });

// A stand-in notifier that actually holds the entries, so "is one already up?" is answered
// the way the real engine answers it — including across a restart, where the id this
// process remembers is gone but the entry on disk is not.
function setup(publishImpl?: Publish, seeded: string[] = []) {
  let counter = 0;
  const live = new Set(seeded);
  const publish = vi.fn<Publish>(
    publishImpl ??
      (() => {
        const id = `entry-${++counter}`;
        live.add(id);
        return Promise.resolve({ id });
      }),
  );
  const clear = vi.fn(async (id: string) => void live.delete(id));
  const list = vi.fn(async () => [...live].map((id) => ({ id })));
  const warn = vi.fn();
  return { publish, clear, list, live, warn, notice: createHealthNotice({ publish, clear, list, log: { warn } }) };
}

// The queue is a promise chain, so a test has to let it drain before asserting.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createHealthNotice", () => {
  it("publishes an urgent notice when the channel gives up", async () => {
    const { notice, publish } = setup();
    notice(health("offline", "listen: Missing or insufficient permissions."));
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    const input = publish.mock.calls[0]?.[0];
    expect(input?.severity).toBe("urgent");
    expect(input?.title).toContain("Remote host");
    expect(input?.body).toContain("Missing or insufficient permissions."); // the reason, not just the fact
  });

  it("says what to do even when no error was reported", async () => {
    const { notice, publish } = setup();
    notice(health("offline"));
    await settle();
    expect(publish.mock.calls[0]?.[0].body).toContain("Reconnect");
  });

  // A blip the runner heals by itself is not worth interrupting anyone over.
  it("stays quiet while the runner is reconnecting", async () => {
    const { notice, publish, clear } = setup();
    notice(health("reconnecting", "listen: unavailable"));
    await settle();
    expect(publish).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears the notice once the channel is back", async () => {
    const { notice, publish, clear } = setup();
    notice(health("offline"));
    await settle();
    notice(health("online"));
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith("entry-1");
  });

  it("keeps at most one notice alive across repeated offline reports", async () => {
    const { notice, publish } = setup();
    notice(health("offline"));
    notice(health("offline"));
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  // The states arrive synchronously while publish/clear are async: applied out of order,
  // a fast offline→online pair would clear nothing and leave the bell red for good.
  it("clears a notice whose publish had not resolved yet", async () => {
    const pending: { resolve?: (value: { id: string }) => void } = {};
    const { notice, clear, live } = setup(() => new Promise((resolve) => (pending.resolve = resolve)));
    notice(health("offline"));
    notice(health("online"));
    await settle();
    expect(clear).not.toHaveBeenCalled(); // still waiting on the publish
    live.add("entry-1");
    pending.resolve?.({ id: "entry-1" });
    await settle();
    expect(clear).toHaveBeenCalledWith("entry-1");
  });

  // After a restart the id this process would have remembered is gone, but the entry the
  // previous one published is still active — asking the notifier is what finds it.
  it("clears a notice left behind by a previous process", async () => {
    const { notice, clear } = setup(undefined, ["from-last-boot"]);
    notice(health("online"));
    await settle();
    expect(clear).toHaveBeenCalledWith("from-last-boot");
  });

  it("does not stack a second notice on top of one a previous process left", async () => {
    const { notice, publish } = setup(undefined, ["from-last-boot"]);
    notice(health("offline"));
    await settle();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes again after a clear, rather than going silent for the rest of the process", async () => {
    const { notice, publish } = setup();
    notice(health("offline"));
    await settle();
    notice(health("online"));
    await settle();
    notice(health("offline"));
    await settle();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not clear when nothing was published", async () => {
    const { notice, clear } = setup();
    notice(health("online"));
    await settle();
    expect(clear).not.toHaveBeenCalled();
  });

  // A notifier problem must not take the runner down with it.
  it("logs a failing publish instead of rejecting", async () => {
    const { notice, warn } = setup(() => Promise.reject(new Error("disk full")));
    notice(health("offline"));
    await settle();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("recovers from a failed publish on the next outage", async () => {
    let failing = true;
    const { notice, publish } = setup(() => (failing ? Promise.reject(new Error("nope")) : Promise.resolve({ id: "entry-2" })));
    notice(health("offline"));
    await settle();
    failing = false;
    notice(health("offline"));
    await settle();
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
