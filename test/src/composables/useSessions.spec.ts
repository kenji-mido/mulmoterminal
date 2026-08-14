import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useSessions, type Session } from "../../../src/composables/useSessions";

function row(id: string): Session {
  return { id, working: false, waiting: false };
}

// #620 F4: load() runs on every "sessions" push, so bursts put several requests in flight and
// they can answer out of order. Driven through the composable — the guard is about WHICH
// answer writes, which no pure function can show on its own.
describe("useSessions — out-of-order responses", () => {
  const listOf = (ids: string[]) => ({ ok: true, json: async () => ({ sessions: ids.map(row) }) });

  it("ignores an older answer that lands after a newer one", async () => {
    const releases: ((value: unknown) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((resolve) => releases.push(resolve))),
    );
    const { sessions, load } = useSessions();
    const first = load();
    const second = load();
    await nextTick();

    // The newer request answers first, then the older one arrives late.
    releases[1]?.(listOf(["new"]));
    await second;
    releases[0]?.(listOf(["old"]));
    await first;
    await flushPromises();

    expect(sessions.value.map((s) => s.id)).toEqual(["new"]);
  });

  // Codex on #628: guarding against "a newer request exists" instead of "a newer answer is
  // already applied" throws away a perfectly good older answer whenever the newer request
  // fails first — the favicon is left with nothing although valid data arrived.
  it("still applies an older answer when the newer request failed", async () => {
    const settle: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((resolve, reject) => settle.push({ resolve, reject }))),
    );
    const { sessions, load } = useSessions();
    const older = load();
    const newer = load();
    await nextTick();

    settle[1]?.reject(new Error("offline"));
    await newer;
    settle[0]?.resolve(listOf(["a"]));
    await older;
    await flushPromises();

    expect(sessions.value.map((s) => s.id)).toEqual(["a"]);
  });

  it("applies the answer when nothing newer was asked for", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(listOf(["a"])));
    const { sessions, load } = useSessions();
    await load();
    await flushPromises();
    expect(sessions.value.map((s) => s.id)).toEqual(["a"]);
  });

  // A failing refetch must not blank a populated list: load() runs on every push, and the
  // favicon would drop to idle while sessions are still running.
  it("keeps the last good list when a later request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(listOf(["a"])));
    const { sessions, load } = useSessions();
    await load();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await load();
    await flushPromises();
    expect(sessions.value.map((s) => s.id)).toEqual(["a"]);
  });

  // A row the favicon cannot fold is dropped rather than admitted as half-idle.
  it("drops rows missing working/waiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [row("good"), { id: "bad", working: true }] }) }));
    const { sessions, load } = useSessions();
    await load();
    await flushPromises();
    expect(sessions.value.map((s) => s.id)).toEqual(["good"]);
  });
});
