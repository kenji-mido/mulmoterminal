// The grid mirrors its layout server-side so a second browser — a phone — hydrates the same
// cells instead of an empty grid. What is worth pinning is not the mirroring but its GATE.
//
// The grid can only seed the shared state from its own local layout when the server has
// answered "nothing saved". After a mere fetch FAILURE this browser knows nothing, and seeding
// blind broadcasts an empty grid over everyone else's cells — the failure mode is another
// device's terminals disappearing, with no error anywhere to connect it to.
//
// gridStateServer's own spec covers the ok / ok+null / failure distinction in the helper. This
// covers the half that decides what to DO with it, which is where the bug was.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { parseServerGridState } from "../../../src/components/gridStateServer";
import { STATE_KEY } from "../../../src/components/gridTabs";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/composables/useGridActivity", () => ({ useGridActivity: () => ({ activity: new Map() }) }));

const server = vi.hoisted(() => ({
  fetchServerGridState: vi.fn(),
  saveServerGridState: vi.fn(),
}));

vi.mock("../../../src/components/gridStateServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/components/gridStateServer")>();
  return { ...actual, fetchServerGridState: server.fetchServerGridState, saveServerGridState: server.saveServerGridState };
});

const SESSION = "11111111-1111-1111-1111-111111111111";
const localGrid = { cells: [{ uid: 0, session: SESSION, cwd: "/w", launcher: null }], expanded: null, page: 0, nextUid: 1, sortMode: "manual" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(STATE_KEY, JSON.stringify(localGrid));
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd: "/w", home: "/w", cwdPresets: [], launchers: [] }) })) as unknown as typeof fetch;
});

const mountGrid = async () => {
  const w = mount((await import("../../../src/components/GridView.vue")).default, {
    global: { stubs: { TerminalGrid: true, AppToolbar: true, SettingsModal: true } },
  });
  await flushPromises();
  return w;
};

describe("GridView shared grid state", () => {
  it("seeds the server from this browser when the server confirms it has nothing", async () => {
    server.fetchServerGridState.mockResolvedValue({ ok: true, state: null });
    await mountGrid();
    expect(server.saveServerGridState).toHaveBeenCalled();
  });

  // The regression: seeding after a FAILED fetch broadcasts this browser's grid — possibly an
  // empty one — over every other device's cells.
  it("does NOT seed the server after a failed fetch", async () => {
    server.fetchServerGridState.mockResolvedValue({ ok: false, state: null });
    await mountGrid();
    expect(server.saveServerGridState).not.toHaveBeenCalled();
  });

  it("adopts the server's grid rather than overwriting it", async () => {
    // Through the real parser, because that is the shape a server answer actually has — and
    // the echo suppression compares against exactly that normalized form.
    const remote = parseServerGridState({
      cells: [{ uid: 7, session: "22222222-2222-2222-2222-222222222222", cwd: "/other", launcher: null }],
      expanded: null,
      page: 0,
      nextUid: 8,
      sortMode: "manual",
    });
    server.fetchServerGridState.mockResolvedValue({ ok: true, state: remote });
    await mountGrid();
    // Adopted, not re-broadcast: the grid we just took from the server is not ours to publish.
    expect(server.saveServerGridState).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}").cells?.[0]?.session).toBe(remote?.cells[0].session);
  });
});
