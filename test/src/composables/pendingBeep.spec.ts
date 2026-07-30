import { describe, it, expect } from "vitest";
import { createBeepQueue, shouldHoldBeep } from "../../../src/composables/pendingBeep";

describe("shouldHoldBeep", () => {
  it("lets a running context play", () => {
    expect(shouldHoldBeep("running")).toBe(false);
  });

  it("holds while the browser has not unlocked audio", () => {
    expect(shouldHoldBeep("suspended")).toBe(true);
  });

  it("holds a closed context too — it is just as silent", () => {
    expect(shouldHoldBeep("closed")).toBe(true);
  });

  it("does not hold when there is no context at all", () => {
    // Nothing would ever resume to flush it, so holding would lose the beep for good.
    expect(shouldHoldBeep(null)).toBe(false);
  });
});

describe("createBeepQueue", () => {
  it("starts empty", () => {
    expect(createBeepQueue().take()).toBeNull();
  });

  it("returns what it held", () => {
    const queue = createBeepQueue();
    queue.hold({ kind: "waiting", cwd: "/repo" });
    expect(queue.take()).toEqual({ kind: "waiting", cwd: "/repo" });
  });

  it("collapses a burst to the LATEST one — the point of the queue", () => {
    const queue = createBeepQueue();
    queue.hold({ kind: "finished", cwd: "/a" });
    queue.hold({ kind: "waiting", cwd: "/b" });
    queue.hold({ kind: "finished", cwd: "/c" });
    expect(queue.take()).toEqual({ kind: "finished", cwd: "/c" });
  });

  it("takes only once, so an unlock cannot replay the same beep twice", () => {
    const queue = createBeepQueue();
    queue.hold({ kind: "waiting", cwd: null });
    queue.take();
    expect(queue.take()).toBeNull();
  });

  it("clear drops the held beep — sound turned off must not replay later", () => {
    const queue = createBeepQueue();
    queue.hold({ kind: "waiting", cwd: null });
    queue.clear();
    expect(queue.take()).toBeNull();
  });

  it("keeps two queues independent", () => {
    const one = createBeepQueue();
    const two = createBeepQueue();
    one.hold({ kind: "waiting", cwd: null });
    expect(two.take()).toBeNull();
    expect(one.take()).not.toBeNull();
  });
});
