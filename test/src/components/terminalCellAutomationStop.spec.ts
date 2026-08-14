import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Closing a cell does NOT unmount this component — it goes back to the launch form — so the stop
// flag `onUnmounted` sets never fired on the close path. An automation started here would keep
// polling and could submit another turn into the OTHER cells after the user closed this one.
// (Codex review on #1456.)

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: {
      terminate() {},
    },
  },
}));

// One other readable terminal, so the picker has a seat to offer.
vi.mock("../../../src/composables/useHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useHandoff")>()),
  handoffTargets: () => [{ key: "cell-2", label: "#2 · codex", source: { sessionId: "S2", cwd: "/w", agent: "codex" } }],
}));

// The runner is replaced by a capture: what matters is the ABORT SIGNAL it was handed, and whether
// that signal flips when the cell closes. The real deps builder is kept, so the signal is the same
// closure the component actually passes.
let abortSignal: (() => boolean) | null = null;
vi.mock("../../../src/composables/useRoundTable", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/composables/useRoundTable")>();
  return {
    ...original,
    runRoundTable: (_members: unknown, _room: string, _budget: number, deps: { isAborted: () => boolean }) => {
      abortSignal = deps.isAborted;
      return new Promise(() => {}); // never settles: the table is "in flight" for the whole test
    },
  };
});

const TerminalCell = (await import("../../../src/components/TerminalCell.vue")).default;

const mountCell = () =>
  mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: "11111111-1111-1111-1111-111111111111",
      initialCwd: null,
      defaultCwd: "/home/me/proj",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });

describe("closing a cell stops its automation", () => {
  it("flips the round table's abort signal on close, not only on unmount", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const w = mountCell();
    await flushPromises();

    await w.find('[data-testid="cell-ask"]').trigger("click");
    await flushPromises();
    await w.find('[data-testid="round-table-seat"]').setValue(true);
    await w.find('[data-testid="round-table-start"]').trigger("click");
    await flushPromises();

    expect(abortSignal).not.toBeNull();
    expect(abortSignal?.()).toBe(false); // the table is running

    await w.find(".cell-close").trigger("click");
    await flushPromises();

    // The loop reads this before every submit, so a true here is what stops it typing into the
    // cells that are still open.
    expect(abortSignal?.()).toBe(true);
  });
});
