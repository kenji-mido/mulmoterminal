import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMcpToolGroups } from "../../../src/composables/useMcpToolGroups";
import { TOOL_GROUPS } from "../../../common/toolGroups";

// The switches themselves are exercised through the launch form (TerminalCell.spec). What is
// tested here is `syncInto` — the write a worktree launch waits on, which has no UI of its own and
// whose failure mode (an agent quietly holding tools the launcher shows as off) is invisible.

interface Post {
  cwd: string;
  group: string;
  enabled: boolean;
}

function mockGroups(byCwd: Record<string, string[]>, opts: { unreadable?: string } = {}) {
  const posted: Post[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    const cwd = decodeURIComponent(String(url).split("cwd=")[1] ?? "");
    if (opts.unreadable === cwd) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ groups: byCwd[cwd] ?? [] }) };
  }) as unknown as typeof fetch;
  return posted;
}

beforeEach(() => {
  mockGroups({});
});

describe("useMcpToolGroups", () => {
  it("reads the directory's registrations into the switches", async () => {
    mockGroups({ "/repo": ["render", "external"] });
    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    expect(mcp.dir.value).toBe("/repo");
    expect(mcp.enabled.value.render).toBe(true);
    expect(mcp.enabled.value.external).toBe(true);
    expect(mcp.enabled.value.data).toBe(false);
  });

  it("shows no switches at all when the read fails — a guessed position would write the wrong way", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    expect(mcp.dir.value).toBeNull();
  });

  it("forgets the directory without asking for another", async () => {
    mockGroups({ "/repo": ["render"] });
    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    mcp.forget();
    expect(mcp.dir.value).toBeNull();
  });

  it("writes only the groups the worktree disagrees on", async () => {
    const posted = mockGroups({ "/repo": ["render"], "/wt/task": ["render", "external"] });
    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    await mcp.syncInto("/wt/task");
    // render agrees; data and media are off on both sides; only the stale `external` moves.
    expect(posted).toEqual([{ cwd: "/wt/task", group: "external", enabled: false }]);
  });

  it("writes every group when the worktree's own state can't be read", async () => {
    const posted = mockGroups({ "/repo": ["render"] }, { unreadable: "/wt/task" });
    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    await mcp.syncInto("/wt/task");
    expect(posted.map((p) => p.group)).toEqual([...TOOL_GROUPS]);
    expect(posted.find((p) => p.group === "render")?.enabled).toBe(true);
    expect(posted.filter((p) => p.group !== "render").every((p) => !p.enabled)).toBe(true);
  });

  // Every write shells out to the `claude` CLI, so the loop runs for seconds with the launcher
  // still on screen and its directory field editable. A reload for a newly typed directory
  // replaces the switches wholesale; read lazily, the writes still pending would carry THAT
  // directory's positions into this repository's worktree.
  it("writes the positions as they were when the launch started, not as they became", async () => {
    const posted: Post[] = [];
    let releaseFirstWrite: () => void = () => {};
    const firstWrite = new Promise<void>((r) => (releaseFirstWrite = r));
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        if (posted.length === 1) await firstWrite;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      const cwd = decodeURIComponent(String(url).split("cwd=")[1] ?? "");
      // The repo has all four on; the worktree has none, so all four are due to be written.
      return { ok: true, json: async () => ({ groups: cwd === "/repo" ? [...TOOL_GROUPS] : [] }) };
    }) as unknown as typeof fetch;

    const mcp = useMcpToolGroups();
    await mcp.load("/repo");
    const syncing = mcp.syncInto("/wt/task");
    await Promise.resolve();
    // The user types another directory; its reload lands while the first write is still running.
    await mcp.load("/elsewhere");
    releaseFirstWrite();
    await syncing;

    expect(posted).toHaveLength(TOOL_GROUPS.length);
    expect(posted.every((p) => p.cwd === "/wt/task" && p.enabled)).toBe(true);
  });

  it("writes nothing when the switches belong to no directory, or to the worktree itself", async () => {
    const posted = mockGroups({ "/repo": ["render"] });
    const unloaded = useMcpToolGroups();
    await unloaded.syncInto("/wt/task");
    const loaded = useMcpToolGroups();
    await loaded.load("/repo");
    await loaded.syncInto("/repo");
    expect(posted).toEqual([]);
  });
});
