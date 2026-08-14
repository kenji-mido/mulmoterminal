// @vitest-environment node
//
// The primitive both `app.json` writes and whole shared-app operations are kept in line by.
//
// It is tested here rather than through the operations because the property is about ORDER, and
// order is exactly what an integration test of two refusals cannot show: they finish too fast to
// have overlapped, whatever the lock does.
import { describe, it, expect } from "vitest";
import { serializeBy } from "../../../server/backends/sharedApp/serialize.js";

/** A task that reports when it starts and finishes, so overlap is visible rather than inferred. */
const tracked = (log: string[], name: string, ms: number) => async (): Promise<void> => {
  log.push(`${name}:start`);
  await new Promise((resolve) => setTimeout(resolve, ms));
  log.push(`${name}:end`);
};

describe("serializeBy", () => {
  it("runs same-key work one at a time, in the order it was asked for", async () => {
    const log: string[] = [];
    // The slow one FIRST: without a lock it would finish last and the interleaving would show.
    await Promise.all([serializeBy("k", tracked(log, "a", 20)), serializeBy("k", tracked(log, "b", 0)), serializeBy("k", tracked(log, "c", 0))]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("lets different keys run at once — two repositories must not wait on each other", async () => {
    const log: string[] = [];
    await Promise.all([serializeBy("one", tracked(log, "one", 20)), serializeBy("two", tracked(log, "two", 0))]);
    expect(log).toEqual(["one:start", "two:start", "two:end", "one:end"]);
  });

  it("does not let a failure stop the next one", async () => {
    // A rejected predecessor must not reject its successor: the chain is a lock, not a pipeline,
    // and one operation refusing is the ordinary case here.
    const failing = serializeBy("k", () => Promise.reject(new Error("nope")));
    await expect(failing).rejects.toThrow("nope");
    await expect(serializeBy("k", () => Promise.resolve("after"))).resolves.toBe("after");
  });

  it("forgets a key once its work is done", async () => {
    // Otherwise the map grows with every project ever deployed. Observable only through behaviour:
    // a later call must not be waiting on a settled chain.
    await serializeBy("k", () => Promise.resolve());
    const log: string[] = [];
    await Promise.all([serializeBy("k", tracked(log, "a", 0)), serializeBy("other", tracked(log, "b", 0))]);
    expect(log).toContain("a:end");
    expect(log).toContain("b:end");
  });
});
