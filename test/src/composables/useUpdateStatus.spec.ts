import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { UpdateStatus } from "../../../common/updateStatus";

afterEach(() => vi.unstubAllGlobals());

const GIT_NOTICE = "Update available: a1b2c3d → origin  ·  run: git pull";

const served = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  ready: true,
  install: "npm",
  version: "4.7.0",
  commit: null,
  latest: null,
  notice: null,
  ...over,
});

// The composable holds ONE status for the whole app — two components read it — so each case has
// to start from a fresh module graph, or it inherits the previous case's answer. That is also why
// the import lives in here rather than at module scope (vi.resetModules only affects later ones).
async function mountStatus() {
  vi.resetModules();
  const { useUpdateStatus } = await import("../../../src/composables/useUpdateStatus");
  let api!: ReturnType<typeof useUpdateStatus>;
  mount(
    defineComponent({
      setup() {
        api = useUpdateStatus();
        return () => h("div");
      },
    }),
  );
  return { badge: () => api.badge.value, status: () => api.status.value };
}

describe("useUpdateStatus", () => {
  it("exposes a badge when the server reports a notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => served({ notice: GIT_NOTICE }) })),
    );
    const { badge } = await mountStatus();
    await flushPromises();
    expect(badge()?.command).toBe("git pull");
  });

  it("has no badge when the server reports none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => served() })),
    );
    const { badge } = await mountStatus();
    await flushPromises();
    expect(badge()).toBeNull();
  });

  // What the Settings version line reads.
  it("exposes the running install", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => served({ install: "git", commit: "a1b2c3d" }) })),
    );
    const { status } = await mountStatus();
    await flushPromises();
    expect(status()).toMatchObject({ install: "git", version: "4.7.0", commit: "a1b2c3d" });
  });

  // The request may fail — badge and version line just stay hidden.
  it("stays hidden when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { badge, status } = await mountStatus();
    await flushPromises();
    expect(badge()).toBeNull();
    expect(status()).toBeNull();
  });

  // The server's check reaches the network (ls-remote can take seconds), so the first read is not
  // ready; a later poll must pick the notice up rather than give up on the first empty answer.
  it("shows the badge when the notice arrives on a later poll", async () => {
    vi.useFakeTimers();
    try {
      let body = served({ ready: false }); // the server check hasn't finished yet
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => body })),
      );
      const { badge } = await mountStatus();
      await vi.advanceTimersByTimeAsync(0);
      expect(badge()).toBeNull();

      body = served({ notice: GIT_NOTICE }); // the check finished behind
      await vi.advanceTimersByTimeAsync(3000);
      expect(badge()?.command).toBe("git pull");
    } finally {
      vi.useRealTimers();
    }
  });

  // "Up to date" is a ready answer with no notice, and re-asking cannot change it until the
  // server restarts.
  it("stops polling as soon as the answer has landed", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => served() }));
      vi.stubGlobal("fetch", fetchMock);
      await mountStatus();
      await vi.advanceTimersByTimeAsync(3000 * 10);
      expect(fetchMock.mock.calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // A check that never lands must not hammer the endpoint forever.
  it("gives up after a bounded number of unready reads", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => served({ ready: false }) }));
      vi.stubGlobal("fetch", fetchMock);
      await mountStatus();
      await vi.advanceTimersByTimeAsync(3000 * 10);
      expect(fetchMock.mock.calls).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  // Opening Settings long after the loop gave up must ask again, not inherit the dead end.
  it("asks again when a later consumer appears and nothing has landed", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => served({ ready: false }) }));
      vi.stubGlobal("fetch", fetchMock);
      vi.resetModules();
      const { useUpdateStatus } = await import("../../../src/composables/useUpdateStatus");
      useUpdateStatus();
      await vi.advanceTimersByTimeAsync(3000 * 10);
      expect(fetchMock.mock.calls).toHaveLength(5);

      useUpdateStatus();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
