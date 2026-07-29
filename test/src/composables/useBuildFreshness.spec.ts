// What this decides is when to interrupt someone. Say nothing and a tab runs yesterday's code
// through an afternoon of debugging; say it wrongly — on every restart, or on a dev server that
// has no build to name — and the notice becomes noise the user learns to ignore.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const pubsub = vi.hoisted(() => ({ handlers: [] as Array<() => void> }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: () => () => {},
    onReconnect: (fn: () => void) => {
      pubsub.handlers.push(fn);
      return () => {};
    },
  }),
}));

import { isStaleBuild, useBuildFreshness } from "../../../src/composables/useBuildFreshness";

const reconnect = async () => {
  pubsub.handlers.forEach((fn) => fn());
  await flushPromises();
};

// Mount it in a throwaway component so onMounted/onUnmounted have an instance to hang off.
async function mountFreshness() {
  let stale!: ReturnType<typeof useBuildFreshness>["stale"];
  mount({
    setup() {
      ({ stale } = useBuildFreshness());
      return () => null;
    },
  });
  await flushPromises();
  return () => stale.value;
}

const serving = (ids: (string | null)[]) => {
  const queue = [...ids];
  globalThis.fetch = vi.fn(async () => {
    const buildId = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, json: async () => ({ buildId }) };
  }) as unknown as typeof fetch;
};

describe("isStaleBuild", () => {
  it("is stale only when both sides name a build and they differ", () => {
    expect(isStaleBuild("aaa", "bbb")).toBe(true);
    expect(isStaleBuild("aaa", "aaa")).toBe(false);
  });

  // A dev server serves no built client. Nothing to compare, nothing to say.
  it("says nothing when either side has no build", () => {
    expect(isStaleBuild(null, "bbb")).toBe(false);
    expect(isStaleBuild("aaa", null)).toBe(false);
    expect(isStaleBuild(null, null)).toBe(false);
  });
});

describe("useBuildFreshness", () => {
  beforeEach(() => {
    pubsub.handlers.length = 0;
  });

  it("stays quiet while the server serves the build this tab loaded", async () => {
    serving(["build-1"]);
    const stale = await mountFreshness();
    await reconnect();
    expect(stale()).toBe(false);
  });

  // The case it exists for: the server was rebuilt and restarted, every client reconnected, and
  // this tab is now the only thing still running the old bundle.
  it("reports stale once the server serves a different build", async () => {
    serving(["build-1", "build-2"]);
    const stale = await mountFreshness();
    expect(stale()).toBe(false); // the first answer is what we are running
    await reconnect();
    expect(stale()).toBe(true);
  });

  it("does not go back to fresh — only a reload can do that", async () => {
    serving(["build-1", "build-2", "build-1"]);
    const stale = await mountFreshness();
    await reconnect();
    await reconnect();
    expect(stale()).toBe(true);
  });

  it("stays quiet on a dev server, which names no build", async () => {
    serving([null]);
    const stale = await mountFreshness();
    await reconnect();
    expect(stale()).toBe(false);
  });

  // Mid-restart the fetch fails. That is not evidence of anything.
  it("stays quiet when the check cannot reach the server", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const stale = await mountFreshness();
    await reconnect();
    expect(stale()).toBe(false);
  });
});
