import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mergeStable, isBackground, isUnread, matchesFilter, useSessions, type Session } from "../../../src/composables/useSessions";

function row(id: string): Session {
  return { id, title: id, mtime: 1, working: false, waiting: false };
}

describe("isUnread", () => {
  it("is true for a waiting, non-hidden session", () => {
    expect(isUnread({ ...row("a"), waiting: true })).toBe(true);
  });

  it("is false when not waiting", () => {
    expect(isUnread(row("a"))).toBe(false);
  });

  it("is false for a hidden background worker even when waiting (the bug fix)", () => {
    expect(isUnread({ ...row("a"), waiting: true, hidden: true })).toBe(false);
  });
});

describe("isBackground", () => {
  it("is true for a hidden worker", () => {
    expect(isBackground({ ...row("a"), hidden: true })).toBe(true);
  });

  it("is false for a session the user started", () => {
    expect(isBackground(row("a"))).toBe(false);
  });
});

describe("matchesFilter", () => {
  const chat = row("chat");
  const worker = { ...row("worker"), hidden: true };
  const waitingChat = { ...row("waiting"), waiting: true };
  const waitingWorker = { ...row("waiting-worker"), waiting: true, hidden: true };

  // The point of the feature: the default chip is the user's own chats, so a collection
  // refreshing on a schedule stops filling the history (#1060).
  it("excludes background workers from the default chip", () => {
    expect(matchesFilter(chat, "all")).toBe(true);
    expect(matchesFilter(worker, "all")).toBe(false);
  });

  it("shows only background workers under the background chip", () => {
    expect(matchesFilter(worker, "background")).toBe(true);
    expect(matchesFilter(chat, "background")).toBe(false);
  });

  // A background worker sitting at a permission prompt is `waiting`; it is still not
  // something to read, so unread stays what isUnread says.
  it("keeps unread free of background workers", () => {
    expect(matchesFilter(waitingChat, "unread")).toBe(true);
    expect(matchesFilter(waitingWorker, "unread")).toBe(false);
    expect(matchesFilter(chat, "unread")).toBe(false);
  });

  // Every row the server sends is reachable from some chip — otherwise a session exists
  // that cannot be opened, and a MulmoTerminal session is a live terminal.
  it("matches every row under exactly one of all/background", () => {
    for (const s of [chat, worker, waitingChat, waitingWorker]) {
      expect(matchesFilter(s, "all")).not.toBe(matchesFilter(s, "background"));
    }
  });
});

describe("mergeStable", () => {
  it("takes the server order on the first load (empty prev)", () => {
    const incoming = [row("a"), row("b")];
    expect(mergeStable([], incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("keeps existing rows in place even when the server reorders them", () => {
    // The server sorts by recency; switching sessions bumps mtimes and would
    // otherwise reshuffle the list under the user.
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")]; // b is now newest
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("prepends genuinely-new sessions (newest-first) and drops vanished ones", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("c"), row("a")]; // b gone, c new; (no b)
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("refreshes the data of kept rows in place", () => {
    const prev = [{ ...row("a"), working: false }];
    const incoming = [{ ...row("a"), working: true }];
    const merged = mergeStable(prev, incoming, false);
    expect(merged[0].working).toBe(true);
  });

  it("re-sorts to the server order when resort is requested", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")];
    expect(mergeStable(prev, incoming, true).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

// #620 F4: load() runs on every "sessions" push, so bursts put several requests in flight and
// they can answer out of order. Driven through the composable — the guard is about WHICH
// answer writes, which no pure function can show on its own.
describe("useSessions — out-of-order responses", () => {
  const listOf = (ids: string[]) => ({ ok: true, json: async () => ({ sessions: ids.map(row) }) });

  it("ignores an older answer that lands after a newer one", async () => {
    const releases: ((value: unknown) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("codex")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
        return new Promise((resolve) => releases.push(resolve));
      }),
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
  // already on screen" throws away a perfectly good older answer whenever the newer request
  // fails first — the user gets an error banner and an empty list although valid data arrived.
  it("still applies an older answer when the newer request failed", async () => {
    const settle: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("codex")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
        return new Promise((resolve, reject) => settle.push({ resolve, reject }));
      }),
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(String(url).includes("codex") ? { ok: true, json: async () => ({ sessions: [] }) } : listOf(["a"])),
        ),
    );
    const { sessions, load } = useSessions();
    await load();
    await flushPromises();
    expect(sessions.value.map((s) => s.id)).toEqual(["a"]);
  });
});
