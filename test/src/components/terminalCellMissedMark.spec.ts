// The cell's rendering of a notification nobody heard (#1152). Its own file rather than more
// lines in TerminalCell.spec.ts, which already trips the max-lines warning.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { applyMissedMark, useMissedAttention } from "../../../src/composables/useMissedAttention";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["sessionId", "connectKey", "cwd", "hideHeader"], template: '<div class="stub-term" />' },
}));

const SESSION = "33333333-3333-3333-3333-333333333333";
const RING = "ring-2";

const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();
const dotTitle = (w: ReturnType<typeof mount>) => w.find(".cell-dot").attributes("title") ?? "";

function mountCell(expanded = false) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded,
      zoomed: false,
      initialSessionId: SESSION,
      initialCwd: null,
      defaultCwd: "/home/me/my-project",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });
}

beforeEach(() => {
  useMissedAttention().acknowledge(SESSION);
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) })) as unknown as typeof fetch;
});

describe("TerminalCell missed-notification mark", () => {
  it("shows no ring for a session the user was told about", async () => {
    const w = mountCell();
    await flushPromises();
    expect(dotClass(w)).not.toContain(RING);
  });

  it("rings the status dot once the session is marked", async () => {
    const w = mountCell();
    await flushPromises();
    applyMissedMark(SESSION, "mark");
    await nextTick();
    expect(dotClass(w)).toContain(RING);
  });

  it("says why in the dot's title, so the ring is explainable on hover", async () => {
    const w = mountCell();
    await flushPromises();
    applyMissedMark(SESSION, "mark");
    await nextTick();
    expect(dotTitle(w)).toContain("missed");
  });

  it("drops the ring when the mark is cleared", async () => {
    const w = mountCell();
    await flushPromises();
    applyMissedMark(SESSION, "mark");
    await nextTick();
    applyMissedMark(SESSION, "clear");
    await nextTick();
    expect(dotClass(w)).not.toContain(RING);
  });

  it("treats enlarging the cell as the acknowledgement", async () => {
    const w = mountCell();
    await flushPromises();
    applyMissedMark(SESSION, "mark");
    await nextTick();
    await w.setProps({ expanded: true });
    await nextTick();
    expect(dotClass(w)).not.toContain(RING);
  });

  it("never shows a ring on a cell that mounts already enlarged", async () => {
    applyMissedMark(SESSION, "mark");
    const w = mountCell(true);
    await flushPromises();
    expect(dotClass(w)).not.toContain(RING);
  });

  it("acknowledges a mark that arrives while the cell is ALREADY enlarged", async () => {
    // Nothing to point the user at: the pane is on screen.
    const w = mountCell(true);
    await flushPromises();
    applyMissedMark(SESSION, "mark");
    await nextTick();
    expect(dotClass(w)).not.toContain(RING);
  });
});
