import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GuiPanel from "../../../src/components/GuiPanel.vue";

// The Canvas toolbar's buttons. They only ASK — the grid owns the layout and the state — so what
// this pins is that the expand button reports the state it was handed, in the glyph and to a
// screen reader. The layout it produces is pinned in paneExpand.spec.ts, and the Tools pane's
// matching header in ToolsPaneExpand.spec.ts.

const mountPanel = (expanded?: boolean) =>
  mount(GuiPanel, {
    props: { sessionId: "s1", sendTextMessage: () => true, ...(expanded === undefined ? {} : { expanded }) },
    global: { stubs: { PluginFrame: true } },
  });

describe("the Canvas toolbar", () => {
  it("asks the grid to expand, and says which way it would go", async () => {
    const w = mountPanel(false);
    const btn = w.get('[data-testid="canvas-expand-btn"]');
    expect(btn.text()).toBe("open_in_full");
    expect(btn.attributes("aria-pressed")).toBe("false");

    await btn.trigger("click");
    expect(w.emitted("toggleExpand")).toHaveLength(1);
  });

  it("flips to restore once expanded", () => {
    const btn = mountPanel(true).get('[data-testid="canvas-expand-btn"]');
    expect(btn.text()).toBe("close_fullscreen");
    expect(btn.attributes("aria-pressed")).toBe("true");
  });

  // Three panes share one slot, so the button that dismisses the one showing has to be in the
  // same place whichever it is: last in the header, the `close` glyph, like files and tools.
  it("closes from the right end of the header, as the other panes do", async () => {
    const w = mountPanel(false);
    const buttons = w.findAll("header button, div button");
    expect(buttons[buttons.length - 1].attributes("data-testid")).toBe("canvas-close-btn");
    expect(buttons[buttons.length - 1].text()).toBe("close");

    await w.get('[data-testid="canvas-close-btn"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  // The Tools pane has its own button on every cell's header; a second way in from here was one
  // more thing in a toolbar that now has a job of its own.
  it("no longer offers the tools pane", () => {
    expect(mountPanel().text()).not.toContain("build");
  });
});
