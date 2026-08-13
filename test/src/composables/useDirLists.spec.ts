import { describe, it, expect, vi, beforeEach } from "vitest";
import { useResumableSessions, useDirScripts, useDirWorktrees } from "../../../src/composables/useDirLists";

// The three launcher lists share one loader, so the hazards are tested once each: a superseded
// answer must not land, a refused read must not keep the previous directory's rows, and no
// directory must not fetch at all.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok = (json: unknown) => ({ ok: true, json: async () => json });

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ok({})) as unknown as typeof fetch;
});

describe("useResumableSessions", () => {
  it("lists the sessions and the cwd they were resolved for", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/resolved" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/typed");
    expect(value.value).toEqual({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/resolved" });
  });

  it("falls back to the requested dir when the server doesn't name one", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [] })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/asked");
    expect(value.value.cwd).toBe("/asked");
  });

  it("empties the list — and forgets the cwd — when there is no dir to ask about", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/x");
    await load(null);
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // The reason every one of these carries a request token: typing a path fires a read per
  // keystroke, and the answers can come back in any order.
  it("drops an answer a newer request has superseded", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async (url: string) =>
      String(url).includes("slow") ? slow.promise : ok({ sessions: [{ id: "fast", title: "fast", mtime: 2 }], cwd: "/fast" }),
    ) as unknown as typeof fetch;

    const { value, load } = useResumableSessions();
    const first = load("/slow");
    await load("/fast");
    slow.resolve(ok({ sessions: [{ id: "stale", title: "stale", mtime: 1 }], cwd: "/slow" }));
    await first;

    expect(value.value).toEqual({ sessions: [{ id: "fast", title: "fast", mtime: 2 }], cwd: "/fast" });
  });

  // #1372: the rows have to go when the FIELD changes, not when the replacement lands. Until then
  // they are the previous directory's, and clicking one resumes exactly the session it names.
  it("empties the rows and reports loading the moment the dir is forgotten", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, loading, forget, load } = useResumableSessions();
    await load("/x");
    expect(loading.value).toBe(false);
    forget();
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(loading.value).toBe(true);
  });

  it("drops an answer that was already in flight when the dir was forgotten", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async () => slow.promise) as unknown as typeof fetch;
    const { value, load, forget } = useResumableSessions();
    const pending = load("/slow");
    forget();
    slow.resolve(ok({ sessions: [{ id: "stale", title: "stale", mtime: 1 }], cwd: "/slow" }));
    await pending;
    expect(value.value).toEqual({ sessions: [], cwd: null });
  });

  it("empties the rows before it fetches, and stops loading when the answer lands", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const cwd = new URL(String(url), "http://localhost").searchParams.get("cwd");
      return ok({ sessions: [{ id: `s:${cwd}`, title: "one", mtime: 1 }], cwd });
    }) as unknown as typeof fetch;
    const { value, loading, load } = useResumableSessions();
    await load("/x");
    const next = load("/y");
    // Not awaited: /x's row is gone already, rather than standing there until /y answers.
    expect(value.value).toEqual({ sessions: [], cwd: null });
    expect(loading.value).toBe(true);
    await next;
    expect(value.value.cwd).toBe("/y");
    expect(loading.value).toBe(false);
  });

  it("is not left loading when there is no dir to ask about", async () => {
    const { loading, forget, load } = useResumableSessions();
    forget();
    await load(null);
    expect(loading.value).toBe(false);
  });

  // The flag follows the same rule as the value: the newest request owns it. A superseded one
  // clearing it would say "loaded" while the request that replaced it is still in flight.
  it("leaves the flag to the request that superseded this one", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    const stillPending = deferred<ReturnType<typeof ok>>();
    globalThis.fetch = vi.fn(async (url: string) => (String(url).includes("slow") ? slow.promise : stillPending.promise)) as unknown as typeof fetch;
    const { loading, load } = useResumableSessions();
    const first = load("/slow");
    const newer = load("/newer");
    slow.resolve(ok({ sessions: [], cwd: "/slow" }));
    await first;
    expect(loading.value).toBe(true);
    stillPending.resolve(ok({ sessions: [], cwd: "/newer" }));
    await newer;
    expect(loading.value).toBe(false);
  });

  it("clears the rows when the read throws, rather than showing another dir's", async () => {
    globalThis.fetch = vi.fn(async () => ok({ sessions: [{ id: "a", title: "one", mtime: 1 }], cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useResumableSessions();
    await load("/x");
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await load("/y");
    expect(value.value).toEqual({ sessions: [], cwd: null });
  });
});

describe("useDirScripts", () => {
  it("lists the scripts and the cwd they run in", async () => {
    globalThis.fetch = vi.fn(async () => ok({ scripts: [{ index: 0, label: "build", command: "yarn build" }], cwd: "/resolved" })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/typed");
    expect(value.value).toEqual({ scripts: [{ index: 0, label: "build", command: "yarn build" }], cwd: "/resolved" });
  });

  // A refused read means "nothing to offer here", not "keep what the last directory had" — and
  // the dir asked about is still the one the (empty) list belongs to.
  it("reads a refused response as an empty list for the dir asked about", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/asked");
    expect(value.value).toEqual({ scripts: [], cwd: "/asked" });
  });

  it("ignores a body whose list is not an array", async () => {
    globalThis.fetch = vi.fn(async () => ok({ scripts: "nope", cwd: "/x" })) as unknown as typeof fetch;
    const { value, load } = useDirScripts();
    await load("/x");
    expect(value.value.scripts).toEqual([]);
  });
});

describe("useDirWorktrees", () => {
  it("reports the repo and its worktrees", async () => {
    const worktrees = [{ path: "/wt/a", branch: "agent/a", task: "a", dirty: true }];
    globalThis.fetch = vi.fn(async () => ok({ isGit: true, worktrees })) as unknown as typeof fetch;
    const { value, load } = useDirWorktrees();
    await load("/repo");
    expect(value.value).toEqual({ isGit: true, worktrees });
  });

  it("says not-a-repo when the read is refused", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const { value, load } = useDirWorktrees();
    await load("/plain");
    expect(value.value).toEqual({ isGit: false, worktrees: [] });
  });
});
