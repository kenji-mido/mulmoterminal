import { describe, it, expect, vi, afterEach } from "vitest";
import type { GridState } from "../../../src/components/gridTabs";
import { adoptedGridState, fetchServerGridState, normalizedGridJson, parseServerGridState } from "../../../src/components/gridStateServer";

const grid = (cells: GridState["cells"]): GridState => ({ cells, expanded: null, page: 0, nextUid: cells.length, sortMode: "manual" });
const S = "11111111-1111-1111-1111-111111111111";

describe("normalizedGridJson", () => {
  it("ignores a transient launch cell (session=null) — the sync key is unchanged by opening '+'", () => {
    const withSession = grid([{ uid: 0, session: S, cwd: "/p" }]);
    const plusLaunchCell = grid([
      { uid: 0, session: S, cwd: "/p" },
      { uid: 1, session: null, cwd: null }, // the half-filled "+" launcher
    ]);
    expect(normalizedGridJson(plusLaunchCell)).toBe(normalizedGridJson(withSession));
  });

  it("changes when the SESSION set changes", () => {
    const one = grid([{ uid: 0, session: S, cwd: "/p" }]);
    const two = grid([
      { uid: 0, session: S, cwd: "/p" },
      { uid: 1, session: "22222222-2222-2222-2222-222222222222", cwd: "/q" },
    ]);
    expect(normalizedGridJson(one)).not.toBe(normalizedGridJson(two));
  });

  // Idempotent, and the echo suppression depends on it: a grid adopted from the server must
  // normalize to exactly what the adopter recorded as "last synced", or it re-broadcasts what it
  // just received and the two clients never settle.
  it("is idempotent — a parsed server grid re-normalizes to its own cells", () => {
    const remote = parseServerGridState({ cells: [{ uid: 5, session: S, cwd: "/p" }], expanded: null, page: 0, nextUid: 9, sortMode: "manual" });
    expect(remote).not.toBeNull();
    if (remote) expect(normalizedGridJson(remote)).toBe(JSON.stringify(remote.cells));
  });
});

// The three answers a loading browser must tell apart: a saved grid (adopt), a successful
// "nothing saved" (may seed), and a FAILED request — which must never look like "nothing
// saved", or a fresh browser would seed its empty grid over everyone's cells.
describe("fetchServerGridState", () => {
  const mockFetch = (impl: () => Promise<unknown>) => {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok + the parsed grid when the server has one", async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ state: { cells: [{ uid: 0, session: S, cwd: "/p" }], expanded: null, page: 0, nextUid: 1, sortMode: "manual" } }),
    }));
    const r = await fetchServerGridState();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state?.cells[0]?.session).toBe(S);
  });

  it("returns ok + null state when the server has nothing saved (seeding is allowed)", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ state: null }) }));
    expect(await fetchServerGridState()).toEqual({ ok: true, state: null });
  });

  it("returns ok:false on an HTTP error — NOT 'nothing saved'", async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchServerGridState()).toEqual({ ok: false });
  });

  it("returns ok:false when the request throws (network drop)", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    expect(await fetchServerGridState()).toEqual({ ok: false });
  });
});

// What the two open browsers taught us: a zoom is not a layout change. Including `expanded` in
// the synced form made every zoom a broadcast, the peer adopted it, its cells re-rendered, every
// terminal reconnected — and each reconnect superseded the other browser, which then took them
// back. Two clients spent their time reporting "detached" at each other.
describe("what the shared grid actually shares", () => {
  const cell = (uid: number, session: string) => ({ uid, session, cwd: "/w", launcher: null });
  const grid = (over: Partial<GridState> = {}): GridState =>
    ({
      cells: [cell(0, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), cell(1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")],
      expanded: null,
      page: 0,
      nextUid: 2,
      sortMode: "manual",
      ...over,
    }) as GridState;

  it("is unchanged by zooming — a zoom is where this device is looking", () => {
    expect(normalizedGridJson(grid({ expanded: 1 }))).toBe(normalizedGridJson(grid({ expanded: null })));
  });

  it("is unchanged by paging or re-sorting", () => {
    expect(normalizedGridJson(grid({ page: 3 }))).toBe(normalizedGridJson(grid()));
    expect(normalizedGridJson(grid({ sortMode: "auto" }))).toBe(normalizedGridJson(grid()));
  });

  it("still changes when the cells do", () => {
    const extra = grid({ cells: [...grid().cells, cell(2, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")], nextUid: 3 });
    expect(normalizedGridJson(extra)).not.toBe(normalizedGridJson(grid()));
  });
});

describe("adoptedGridState", () => {
  const cell = (uid: number, session: string) => ({ uid, session, cwd: "/w", launcher: null });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const state = (cells: ReturnType<typeof cell>[], over: Partial<GridState> = {}): GridState =>
    ({ cells, expanded: null, page: 0, nextUid: cells.length, sortMode: "manual", ...over }) as GridState;

  it("takes the peer's cells", () => {
    const local = state([cell(0, A)]);
    const server = state([cell(0, A), cell(1, B)]);
    expect(adoptedGridState(local, server).cells).toEqual(server.cells);
  });

  it("keeps THIS device's page and sort, not the peer's", () => {
    const local = state([cell(0, A)], { page: 2, sortMode: "auto" });
    const server = state([cell(0, A)], { page: 0, sortMode: "manual" });
    const adopted = adoptedGridState(local, server);
    expect([adopted.page, adopted.sortMode]).toEqual([2, "auto"]);
  });

  // Carried by SESSION, because adopting renumbers uids: the number that meant "the cell I am
  // watching" here means a different cell there.
  it("stays zoomed on the same SESSION even when its uid moved", () => {
    const local = state([cell(0, A), cell(1, B)], { expanded: 1 });
    const server = state([cell(0, B), cell(1, A)]); // same sessions, renumbered
    expect(adoptedGridState(local, server).expanded).toBe(0); // still B
  });

  it("un-zooms when the session it was watching is gone", () => {
    const local = state([cell(0, A), cell(1, B)], { expanded: 1 });
    const server = state([cell(0, A)]);
    expect(adoptedGridState(local, server).expanded).toBeNull();
  });

  it("does not invent a zoom for a device that had none", () => {
    const local = state([cell(0, A)]);
    const server = state([cell(0, A), cell(1, B)], { expanded: 1 });
    expect(adoptedGridState(local, server).expanded).toBeNull();
  });
});
