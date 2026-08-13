// @vitest-environment node
// The lock two read-modify-write callers share: starting work on an issue (one worktree per issue)
// and recording a milestone on an issue comment (the body is where the earlier ones live).
import { describe, it, expect } from "vitest";
import { createKeySerializer } from "../../../server/infra/serialize-per-key";

const deferred = () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release: () => release() };
};

describe("createKeySerializer", () => {
  it("runs one task at a time for a key", async () => {
    const serialize = createKeySerializer();
    const gate = deferred();
    const entered = deferred();
    const order: string[] = [];

    const first = serialize("k", async () => {
      order.push("first in");
      entered.release();
      await gate.held;
      order.push("first out");
    });
    const second = serialize("k", async () => {
      order.push("second in");
    });

    await entered.held;
    expect(order).toEqual(["first in"]); // the second has not started
    gate.release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first in", "first out", "second in"]);
  });

  it("lets different keys run at the same time", async () => {
    const serialize = createKeySerializer();
    const gate = deferred();
    const started: string[] = [];

    const held = serialize("a", async () => {
      started.push("a");
      await gate.held;
    });
    await serialize("b", async () => {
      started.push("b");
    });

    expect(started).toEqual(["a", "b"]);
    gate.release();
    await held;
  });

  // A queue that a failure could stop would strand every later caller for that key.
  it("keeps the queue moving after a task throws", async () => {
    const serialize = createKeySerializer();
    const failed = serialize("k", () => Promise.reject(new Error("boom")));
    const after = serialize("k", () => Promise.resolve("ran"));

    await expect(failed).rejects.toThrow("boom");
    expect(await after).toBe("ran");
  });

  it("hands each caller its own result rather than the first one's", async () => {
    const serialize = createKeySerializer();
    const results = await Promise.all([serialize("k", async () => 1), serialize("k", async () => 2)]);
    expect(results).toEqual([1, 2]);
  });
});
