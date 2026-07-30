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
