// @vitest-environment node
import { describe, it, expect } from "vitest";
import { watchCodexActivity, type CodexActivityDeps } from "../../../server/session/codex-activity-watch.js";
import type { CodexTurnBoundary } from "../../../server/agents/codex-activity.js";

const line = (o: unknown) => JSON.stringify(o);
const started = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } }) + "\n";
const complete = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: "done" } }) + "\n";

// A fake rollout the test appends to, driving the loop one tick at a time. `sleep`
// resolves immediately, and the loop is stopped by a tick budget rather than a timer.
function harness(initial: string, startAtEnd: boolean, restoreOpenTurn = false) {
  let content = initial;
  let ticks = 0;
  const maxTicks = 12;
  const boundaries: CodexTurnBoundary[] = [];
  const appendAtTick: Map<number, string> = new Map();
  let missing = false;

  const deps: CodexActivityDeps = {
    fileSize: async () => (missing ? null : Buffer.byteLength(content)),
    readSlice: async (from, to) => Buffer.from(content).subarray(from, to).toString(),
    onBoundary: (b) => boundaries.push(b),
    isAlive: () => ticks < maxTicks,
    startAtEnd,
    restoreOpenTurn,
    sleep: async () => {
      ticks += 1;
      const add = appendAtTick.get(ticks);
      if (add !== undefined) content += add;
    },
  };
  return {
    deps,
    boundaries,
    appendAt: (tick: number, text: string) => appendAtTick.set(tick, text),
    setMissing: (v: boolean) => (missing = v),
    run: () => watchCodexActivity(deps),
  };
}

describe("watchCodexActivity", () => {
  it("reports the boundaries appended while it runs", async () => {
    const h = harness("", false);
    h.appendAt(1, started());
    h.appendAt(3, complete());
    await h.run();
    expect(h.boundaries).toEqual(["started", "completed"]);
  });

  it("reads a fresh session's existing content, so its first turn isn't missed", async () => {
    const h = harness(started(), false);
    await h.run();
    expect(h.boundaries).toEqual(["started"]);
  });

  it("does NOT replay a resumed rollout's history", async () => {
    // The regression this guards: starting a resumed session at offset 0 would re-report
    // every past turn and leave the cell flagged from history rather than from now.
    const h = harness(started("old") + complete("old"), true);
    await h.run();
    expect(h.boundaries).toEqual([]);
  });

  it("still reports a resumed session's NEW turns", async () => {
    const h = harness(started("old") + complete("old"), true);
    h.appendAt(2, started("new"));
    h.appendAt(4, complete("new"));
    await h.run();
    expect(h.boundaries).toEqual(["started", "completed"]);
  });

  // The reattach case (#1538 review): the process behind the file is still RUNNING, so a turn
  // the skipped content leaves open is what it is doing right now — without restoring it the
  // cell sits idle until the turn's END arrives. The end itself then comes off the tail.
  it("restores a turn the skipped content leaves open, then tails its end", async () => {
    const h = harness(started("mid"), true, true);
    h.appendAt(3, complete("mid"));
    await h.run();
    expect(h.boundaries).toEqual(["started", "completed"]);
  });

  // A trailing COMPLETED is history, not state: re-reporting it would re-flag the cell (and
  // re-push) for a turn finished before the restart — the replay startAtEnd exists to prevent.
  it("restores nothing when the skipped content's last turn is closed", async () => {
    const h = harness(started("old") + complete("old"), true, true);
    await h.run();
    expect(h.boundaries).toEqual([]);
  });

  // The writer is still alive at reattach, so the snapshot can land MID-record. The torn
  // record must ride the pending fragment into the tail: judged as a line at restore time, a
  // torn task_complete is ignored there AND unparseable from its suffix alone on the first
  // poll — the completion is lost for good and the restored working flag sticks (#1538 review).
  it("assembles a completion record torn by the reattach snapshot, instead of losing it", async () => {
    const torn = complete("mid");
    const h = harness(started("mid") + torn.slice(0, 25), true, true);
    h.appendAt(2, torn.slice(25));
    await h.run();
    expect(h.boundaries).toEqual(["started", "completed"]);
  });

  it("joins a record split across two polls", async () => {
    const whole = complete();
    const h = harness("", false);
    h.appendAt(1, whole.slice(0, 20));
    h.appendAt(2, whole.slice(20));
    await h.run();
    expect(h.boundaries).toEqual(["completed"]);
  });

  it("waits without failing while the rollout does not exist yet", async () => {
    const h = harness("", false);
    h.setMissing(true);
    h.appendAt(2, started());
    await h.run();
    expect(h.boundaries).toEqual([]); // never readable, so nothing reported — and no throw
  });

  it("starts a resumed session at 0 when the rollout isn't on disk yet", async () => {
    const h = harness("", true);
    h.appendAt(1, started());
    await h.run();
    expect(h.boundaries).toEqual(["started"]);
  });

  it("stops once the session is gone", async () => {
    let alive = true;
    const boundaries: CodexTurnBoundary[] = [];
    let content = "";
    const deps: CodexActivityDeps = {
      fileSize: async () => Buffer.byteLength(content),
      readSlice: async (from, to) => Buffer.from(content).subarray(from, to).toString(),
      onBoundary: (b) => boundaries.push(b),
      isAlive: () => alive,
      startAtEnd: false,
      sleep: async () => {
        alive = false; // the pty went away during the wait
        content += started();
      },
    };
    await watchCodexActivity(deps);
    expect(boundaries).toEqual([]);
  });
});

describe("watcher lifetime", () => {
  it("reports nothing more once its pty has been replaced", async () => {
    // The regression this guards: binding the tail to `ptys.has(id)` rather than to the
    // pty itself. A session reaped and respawned under the SAME id within one poll would
    // leave the old tail alive next to the new one, reporting every boundary twice.
    const ownPty = { id: 1 };
    let current: { id: number } | undefined = ownPty;
    const boundaries: CodexTurnBoundary[] = [];
    let content = "";
    let ticks = 0;
    await watchCodexActivity({
      fileSize: async () => Buffer.byteLength(content),
      readSlice: async (from, to) => Buffer.from(content).subarray(from, to).toString(),
      onBoundary: (b) => boundaries.push(b),
      isAlive: () => current === ownPty,
      startAtEnd: false,
      sleep: async () => {
        ticks += 1;
        if (ticks === 1) current = { id: 2 }; // reaped and respawned under the same id
        content += started();
      },
    });
    expect(boundaries).toEqual([]);
  });
});
