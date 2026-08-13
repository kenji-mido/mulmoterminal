import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ToolsPane from "../../../src/components/ToolsPane.vue";

// The Tools header carries the same pair as the Canvas one, in the same order — the two panes
// share one slot, so a control that moved between them would be a control the user has to look
// for. Kept as its own file rather than folded into GuiPanelExpand.spec.ts so that a change to
// either header fails on the header it changed.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const mountPane = (expanded?: boolean) => mount(ToolsPane, { props: { sessionId: "s1", ...(expanded === undefined ? {} : { expanded }) } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ groups: [], tools: [], calls: [] }) })),
  );
});

describe("the Tools pane header", () => {
  it("asks the grid to expand, and says which way it would go", async () => {
    const w = mountPane(false);
    const btn = w.get('[data-testid="tools-expand-btn"]');
    expect(btn.text()).toBe("open_in_full");
    expect(btn.attributes("aria-pressed")).toBe("false");

    await btn.trigger("click");
    expect(w.emitted("toggleExpand")).toHaveLength(1);
  });

  it("flips to restore once expanded", () => {
    const btn = mountPane(true).get('[data-testid="tools-expand-btn"]');
    expect(btn.text()).toBe("close_fullscreen");
    expect(btn.attributes("aria-pressed")).toBe("true");
  });

  it("keeps close last, as the Canvas header does", async () => {
    const w = mountPane(false);
    const buttons = w.findAll("button");
    expect(buttons[0].attributes("data-testid")).toBe("tools-expand-btn");
    expect(buttons[1].attributes("data-testid")).toBe("tools-close-btn");

    await buttons[1].trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });
});
