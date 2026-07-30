import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsListRow from "../../../../src/components/settings/SettingsListRow.vue";

// Shared by the four Settings lists. `name` exists so a screen reader hears WHICH entry a button
// removes — four lists of "Remove" buttons is what it reads as otherwise.
const mountRow = (name: string, slot = "<span>body</span>") => mount(SettingsListRow, { props: { name }, slots: { default: slot } });

describe("SettingsListRow", () => {
  it("names the remove button after the entry", () => {
    const button = mountRow("owner/repo").find("button");
    expect(button.attributes("aria-label")).toBe("Remove owner/repo");
    expect(button.attributes("title")).toBe("Remove owner/repo");
  });

  it("emits remove when the button is pressed", async () => {
    const w = mountRow("owner/repo");
    await w.find("button").trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
  });

  it("renders the entry's own content before the button", () => {
    const w = mountRow("Shell", '<span class="mine">$SHELL</span>');
    expect(w.find(".mine").text()).toBe("$SHELL");
    // The row is a list item — the four callers put it inside their own <ul>.
    expect(w.element.tagName).toBe("LI");
  });

  // The button must not submit anything: three of the four lists sit next to an add field, and a
  // default-type button inside a form would submit it.
  it("is an explicit type=button", () => {
    expect(mountRow("owner/repo").find("button").attributes("type")).toBe("button");
  });
});
