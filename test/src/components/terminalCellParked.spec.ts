// The cell's rendering of "set aside" (#992). Its own file rather than more lines in
// TerminalCell.spec.ts, which already trips the max-lines warning.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { SUNK_CELL } from "../../../src/components/cellParked";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["sessionId", "connectKey", "cwd", "hideHeader"], template: '<div class="stub-term" />' },
}));

const SESSION = "44444444-4444-4444-4444-444444444444";
const PULSE = "animate-cell-pulse";

interface Activity {
  working?: boolean;
  waiting?: boolean;
  event?: string;
}

const seed = (activity: Activity) => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ working: false, waiting: false, lastPrompt: null, ...activity }),
  })) as unknown as typeof fetch;
};

function mountCell(props: { parked?: boolean; expanded?: boolean; zoomed?: boolean } = {}) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      initialSessionId: SESSION,
      initialCwd: null,
      defaultCwd: "/home/me/my-project",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
      ...props,
    },
  });
}

const innerClasses = (w: ReturnType<typeof mount>) => w.find(".cell-inner").classes();
const dotClasses = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

beforeEach(() => seed({}));

describe("TerminalCell parking", () => {
  it("leaves an unparked cell at full strength", async () => {
    const w = mountCell();
    await flushPromises();
    expect(innerClasses(w)).not.toContain(SUNK_CELL);
  });

  it("sinks a parked cell", async () => {
    const w = mountCell({ parked: true });
    await flushPromises();
    expect(innerClasses(w)).toContain(SUNK_CELL);
  });

  it("brings it back when unparked", async () => {
    const w = mountCell({ parked: true });
    await flushPromises();
    await w.setProps({ parked: false });
    expect(innerClasses(w)).not.toContain(SUNK_CELL);
  });

  // Motion at the edge of vision is what parking is meant to stop paying for, so the dot that
  // pulses while an agent works has to hold still — the colour stays, only the animation goes.
  it("stops the working dot pulsing", async () => {
    seed({ working: true });
    const w = mountCell({ parked: true });
    await flushPromises();
    expect(dotClasses(w)).not.toContain(PULSE);
  });

  it("still pulses when the same session is not parked", async () => {
    seed({ working: true });
    const w = mountCell();
    await flushPromises();
    expect(dotClasses(w)).toContain(PULSE);
  });

  // The accident this feature could cause: a session stopped for a permission prompt, hidden
  // because it was set aside. Nothing proceeds there until the user answers.
  it("never sinks a cell that is waiting on the user", async () => {
    seed({ waiting: true, event: "Notification" });
    const w = mountCell({ parked: true });
    await flushPromises();
    expect(innerClasses(w)).not.toContain(SUNK_CELL);
  });

  // A finished turn is the expected outcome of parking a running agent, so it stays sunk —
  // unlike `blocked` above.
  it("stays sunk when the parked agent finishes its turn", async () => {
    seed({ waiting: true, event: "Stop" });
    const w = mountCell({ parked: true });
    await flushPromises();
    expect(innerClasses(w)).toContain(SUNK_CELL);
  });

  // Enlarging a parked cell is how you look at one WITHOUT waking it. Coming back to full
  // strength on selection would un-park it by the very act of checking on it.
  it("stays sunk while it is the enlarged cell", async () => {
    const w = mountCell({ parked: true, expanded: true });
    await flushPromises();
    expect(innerClasses(w)).toContain(SUNK_CELL);
  });

  // The claim the whole design rests on: a tile and a filmstrip thumbnail are the SAME component
  // instance, teleported rather than remounted (docs/grid-view-modes.md), so one rule covers both.
  // Every other case here mounts the tiled path, which left that claim asserted only in prose.
  // `zoomed && !expanded` is what puts a cell in the strip.
  it("sinks a thumbnail in the filmstrip, not just a tile", async () => {
    const w = mountCell({ parked: true, zoomed: true });
    await flushPromises();
    expect(w.find(".cell-header").exists()).toBe(true); // the strip's CockpitHeader variant
    expect(innerClasses(w)).toContain(SUNK_CELL);
  });

  // What DOES wake it: putting something in. The terminal reports real input only — keystrokes,
  // bound keys and pastes — never the output the server writes back.
  it("wakes on the terminal's first input", async () => {
    const w = mountCell({ parked: true });
    await flushPromises();
    w.findComponent({ name: "TerminalView" }).vm.$emit("input");
    expect(w.emitted("park")?.[0]).toEqual([false]);
  });

  it("says nothing when an awake cell is typed into", async () => {
    const w = mountCell();
    await flushPromises();
    w.findComponent({ name: "TerminalView" }).vm.$emit("input");
    expect(w.emitted("park")).toBeUndefined();
  });

  it("asks the grid to park, and to wake once parked", async () => {
    const w = mountCell();
    await flushPromises();
    await w.find('[data-testid="cell-park-btn"]').trigger("click");
    expect(w.emitted("park")?.[0]).toEqual([true]);

    await w.setProps({ parked: true });
    await w.find('[data-testid="cell-park-btn"]').trigger("click");
    expect(w.emitted("park")?.[1]).toEqual([false]);
  });
});
