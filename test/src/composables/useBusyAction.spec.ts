import { describe, it, expect } from "vitest";

import { useBusyAction } from "../../../src/composables/useBusyAction";

// The guard #1549 was missing: `git worktree add` runs for seconds with nothing on screen changing,
// so the button gets pressed again — and every press succeeded, one worktree each.
describe("useBusyAction", () => {
  /** A promise the test decides when to settle, standing in for the round trip. */
  function gate() {
    let release: () => void = () => {};
    let fail: (e: Error) => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    return { promise, release, fail };
  }

  it("runs the first call and names it", async () => {
    const { busy, run } = useBusyAction();
    const first = gate();
    expect(busy.value).toBeNull();
    const running = run("create", () => first.promise);
    expect(busy.value).toBe("create");
    first.release();
    await running;
    expect(busy.value).toBeNull();
  });

  it("drops a second call while one is in flight", async () => {
    const { run } = useBusyAction();
    const first = gate();
    let secondRan = false;
    const running = run("create", () => first.promise);
    await run("create", async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(false);
    first.release();
    await running;
  });

  // Exclusive across keys, not per key: the callers all shell out to git in ONE repository, where
  // two commands contend on the index lock.
  it("drops a DIFFERENT action while one is in flight", async () => {
    const { run } = useBusyAction();
    const first = gate();
    let removeRan = false;
    const running = run("create", () => first.promise);
    await run("remove:/wt/x", async () => {
      removeRan = true;
    });
    expect(removeRan).toBe(false);
    first.release();
    await running;
  });

  // A failure that left the flag set would leave the form dead with no way back short of a reload —
  // and a failed create is exactly when the user wants to press it again.
  it("releases after the action throws, and lets the retry through", async () => {
    const { busy, run } = useBusyAction();
    await expect(
      run("create", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(busy.value).toBeNull();
    let retried = false;
    await run("create", async () => {
      retried = true;
    });
    expect(retried).toBe(true);
  });

  it("takes the next call once the first settles", async () => {
    const { run } = useBusyAction();
    const first = gate();
    const running = run("create", () => first.promise);
    first.release();
    await running;
    let secondRan = false;
    await run("create", async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });
});
