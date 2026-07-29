import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchServerGridState, normalizedGridJson, parseServerGridState } from "../../../src/components/gridStateServer";
import type { GridState } from "../../../src/components/gridTabs";

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

  it("is idempotent — a parsed server grid re-normalizes to itself", () => {
    const remote = parseServerGridState({ cells: [{ uid: 5, session: S, cwd: "/p" }], expanded: null, page: 0, nextUid: 9, sortMode: "manual" });
    expect(remote).not.toBeNull();
    if (remote) expect(normalizedGridJson(remote)).toBe(JSON.stringify(remote));
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
