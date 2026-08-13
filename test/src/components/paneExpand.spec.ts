import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, type VNode } from "vue";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";

// The Canvas or the Tools pane taken full-width. Two things are pinned here.
//
// WHICH PARTS OF THE SCREEN it may take: the enlarged terminal and nothing else — the roster on
// the left and the filmstrip below are outside the row it lives in — and the terminal it covers
// stays MOUNTED off-screen, because a hidden xterm fits itself to zero and comes back reflowed
// (#1125).
//
// HOW LONG it lasts: exactly as long as the pane does. It is not remembered, and it does not
// survive a close, a reopen, or a switch to another pane.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "rightPane", "canvasAvailable"],
    emits: ["toggle-expand", "toggle-files", "toggle-canvas", "open-canvas", "toggle-tools", "session", "cwd", "run", "close", "move", "status"],
    template: '<div class="stub-cell" />',
  },
}));
vi.mock("../../../src/components/CommandCell.vue", () => ({
  default: { name: "CommandCell", props: ["expanded", "command"], emits: ["toggle-expand", "close", "move", "status"], template: "<div />" },
}));
vi.mock("../../../src/components/LauncherCell.vue", () => ({
  default: { name: "LauncherCell", props: ["expanded", "launcher"], emits: ["toggle-expand", "close", "move", "status", "session"], template: "<div />" },
}));
// The real toolbars are exercised in GuiPanelExpand.spec.ts / ToolsPaneExpand.spec.ts; here both
// panes are stubs that re-emit, so this file tests the grid's layout response, not their markup.
vi.mock("../../../src/components/GuiPanel.vue", () => ({
  default: {
    name: "GuiPanel",
    props: ["sessionId", "sendTextMessage", "unavailable", "expanded"],
    emits: ["toggleExpand", "close"],
    template: '<div class="stub-canvas" />',
  },
}));
vi.mock("../../../src/components/ToolsPane.vue", () => ({
  default: { name: "ToolsPane", props: ["sessionId", "expanded"], emits: ["toggleExpand", "close"], template: '<div class="stub-tools" />' },
}));
vi.mock("../../../src/components/FilesPane.vue", () => ({
  default: {
    name: "FilesPane",
    props: ["cwd", "requestedPath", "initialState"],
    emits: ["close", "dirty"],
    setup: (_p: unknown, { expose, slots }: { expose: (e: Record<string, unknown>) => void; slots: { title?: () => VNode[] } }) => {
      expose({ flush: async () => undefined, reload: () => {}, snapshot: () => ({ openPath: "README.md", expanded: [] }) });
      return () => h("div", { class: "stub-files-pane" }, slots.title?.());
    },
  },
}));

const cell = (uid: number, session: string | null = null): Cell => ({ uid, session, cwd: "/work" });

const mountGrid = (listMode = true) =>
  mount(TerminalGrid, {
    props: {
      cells: [cell(1, "s1"), cell(2, "s2")],
      expandedUid: 1,
      listRows: [],
      cancelUid: null,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable: false,
      listMode,
    },
    attachTo: document.body,
  });

type Grid = ReturnType<typeof mountGrid>;
type PaneName = "GuiPanel" | "ToolsPane";
const pane = (w: Grid, name: PaneName = "GuiPanel") => w.findComponent({ name });
// The cell's buttons TOGGLE, and which pane is showing is remembered in localStorage — so a
// second mount in the same test may already have one open and a blind toggle would close it.
const open = async (w: Grid, name: PaneName = "GuiPanel") => {
  if (pane(w, name).exists()) return;
  w.findComponent({ name: "TerminalCell" }).vm.$emit(name === "GuiPanel" ? "toggle-canvas" : "toggle-tools");
  await flushPromises();
};
const clickExpand = async (w: Grid, name: PaneName = "GuiPanel") => {
  pane(w, name).vm.$emit("toggleExpand");
  await flushPromises();
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ groups: ["render"], tools: [] }) })),
  );
});

describe("expanding a pane over the terminal", () => {
  it("hands the whole row to the canvas and drops the splitter between them", async () => {
    const w = mountGrid();
    await open(w);
    expect(pane(w).props("expanded")).toBe(false);
    expect(pane(w).attributes("style")).toContain("flex: 0 0 480px");
    expect(w.find('[aria-label="Resize side pane"]').exists()).toBe(true);

    await clickExpand(w);
    expect(pane(w).props("expanded")).toBe(true);
    expect(pane(w).attributes("style")).toContain("flex: 1 1 0%");
    // The separator divides two things. With the terminal gone there is nothing to drag.
    expect(w.find('[aria-label="Resize side pane"]').exists()).toBe(false);
  });

  // The tools pane sets its own w-[340px], which would otherwise outlive the layout.
  it("does the same for the tools pane, width class and all", async () => {
    const w = mountGrid();
    await open(w, "ToolsPane");
    await clickExpand(w, "ToolsPane");
    expect(pane(w, "ToolsPane").props("expanded")).toBe(true);
    expect(pane(w, "ToolsPane").attributes("style")).toContain("flex: 1 1 0%");
    expect(pane(w, "ToolsPane").attributes("style")).toContain("width: auto");
    expect(w.find('[aria-label="Resize side pane"]').exists()).toBe(false);
  });

  // The whole point of the off-screen park (#1125): `display: none` would refit xterm to zero.
  it("leaves the covered terminal mounted", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);
    expect(w.findAllComponents({ name: "TerminalCell" })).toHaveLength(2);
    expect(w.find(".zoom-main").classes()).not.toContain("hidden");
    expect(w.find(".zoom-row").classes()).toContain("pane-full");
  });

  // The roster is a sibling of the row, so it is never what gets covered — in either zoom mode.
  it("keeps the roster and the filmstrip out of it", async () => {
    for (const listMode of [true, false]) {
      const w = mountGrid(listMode);
      await open(w);
      await clickExpand(w);
      expect(w.find('[data-testid="cockpit"]').exists()).toBe(listMode);
      expect(w.find(".grid").exists()).toBe(true);
      const row = w.find(".zoom-row");
      expect(row.classes()).toContain("pane-full");
      expect(row.element.contains(w.find(".grid").element)).toBe(false);
      w.unmount();
    }
  });

  it("restores the split row", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);
    await clickExpand(w);
    expect(pane(w).props("expanded")).toBe(false);
    expect(pane(w).attributes("style")).toContain("flex: 0 0 480px");
    expect(w.find('[aria-label="Resize side pane"]').exists()).toBe(true);
  });

  // Off-screen is not out of reach: the parked cell keeps its header buttons and xterm's textarea,
  // so without `inert` a Shift+Tab out of the pane lands on controls nobody can see.
  it("takes the parked terminal out of the tab order, and puts it back", async () => {
    const w = mountGrid();
    await open(w);
    expect(w.find(".zoom-main").attributes("inert")).toBeUndefined();

    await clickExpand(w);
    expect(w.find(".zoom-main").attributes("inert")).toBeDefined();

    await clickExpand(w);
    expect(w.find(".zoom-main").attributes("inert")).toBeUndefined();
  });

  // The roster's floor is the PANE's while full and the TERMINAL's while split, so a roster
  // dragged out while full has taken room the split row needs back. Restoring the remembered
  // paneWidth unclamped is what squeezes the terminal to nothing.
  it("re-clamps the split row after the roster moved while it was full", async () => {
    const widths = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    try {
      const w = mountGrid();
      await open(w);
      await clickExpand(w);

      // End = give the roster everything the pane's floor allows.
      await w.get('[aria-label="Resize the roster"]').trigger("keydown", { key: "End" });
      await clickExpand(w);

      const roster = Number(
        w
          .get('[data-testid="cockpit"]')
          .attributes("style")
          ?.match(/flex-basis: (\d+)px/)?.[1],
      );
      const paneW = Number(
        pane(w)
          .attributes("style")
          ?.match(/flex: 0 0 (\d+)px/)?.[1],
      );
      // Whatever the two took, the terminal keeps its floor (MIN_TERMINAL = 320) out of the stage.
      expect(1200 - 5 - roster - 6 - paneW).toBeGreaterThanOrEqual(320);
    } finally {
      widths.mockRestore();
    }
  });

  it("closes from its own header, full-width or not", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);
    pane(w).vm.$emit("close");
    await flushPromises();
    expect(pane(w).exists()).toBe(false);
    expect(w.find(".zoom-row").classes()).not.toContain("pane-full");
  });
});

// A pane that opens ON TOP of the terminal is a surprise every time but the one where it was
// asked for — and what it hides is what the user was working in. So the takeover is never
// inherited: not by the pane reopened, not by the pane switched to, not by a fresh load.
describe("the takeover is not remembered", () => {
  it("is gone when the same pane is closed and reopened", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);
    pane(w).vm.$emit("close");
    await flushPromises();

    await open(w);
    expect(pane(w).props("expanded")).toBe(false);
    expect(pane(w).attributes("style")).toContain("flex: 0 0 480px");
  });

  it("does not follow a switch to another pane, or come back with the first one", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);

    w.findComponent({ name: "TerminalCell" }).vm.$emit("toggle-files");
    await flushPromises();
    expect(w.findComponent({ name: "FilesPane" }).attributes("style")).toContain("flex: 0 0 480px");
    expect(w.find(".zoom-row").classes()).not.toContain("pane-full");

    await open(w);
    expect(pane(w).props("expanded")).toBe(false);
  });

  // A button on a TILED cell answers for that cell and changes nothing on screen (#1378). Ending
  // the takeover of the pane the user is reading would be a second cell's button rearranging the
  // one in front of them.
  it("survives a pane asked for on another, tiled cell", async () => {
    const w = mountGrid();
    await open(w);
    await clickExpand(w);
    expect(pane(w).props("expanded")).toBe(true);

    w.findAllComponents({ name: "TerminalCell" })[1].vm.$emit("toggle-files");
    await flushPromises();
    expect(pane(w).props("expanded")).toBe(true);
    expect(w.find(".zoom-row").classes()).toContain("pane-full");
  });

  // The other way out: collapsing the zoom hides the row without unmounting the pane, so nothing
  // in setRightPane runs. Zooming back in — on this cell or another — must still be a split row.
  //
  // Both cells are given a pane of their own, because since #1378 that is what decides whether
  // there is one to come back to: a cell that never asked for one arrives with nothing, and this
  // is about the takeover rather than about which cell has a pane.
  it("does not survive collapsing the zoom", async () => {
    const w = mountGrid();
    await open(w);
    w.findAllComponents({ name: "TerminalCell" })[1].vm.$emit("toggle-canvas");
    await flushPromises();
    await clickExpand(w);

    await w.setProps({ expandedUid: null });
    await w.setProps({ expandedUid: 2 });
    await flushPromises();
    expect(pane(w).props("expanded")).toBe(false);
    expect(w.find(".zoom-row").classes()).not.toContain("pane-full");
  });

  it("does not survive a reload", async () => {
    const first = mountGrid();
    await open(first);
    await clickExpand(first);
    first.unmount();

    // Which PANE was open is still remembered — only the takeover is not.
    const second = mountGrid();
    await open(second);
    expect(pane(second).props("expanded")).toBe(false);
  });
});
