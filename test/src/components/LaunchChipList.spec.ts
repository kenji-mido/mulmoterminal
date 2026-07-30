import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LaunchChipList from "../../../src/components/LaunchChipList.vue";

const CHIPS = [
  { key: 0, label: "build", title: "yarn build" },
  { key: 1, label: "test", title: "yarn test" },
];

describe("LaunchChipList", () => {
  it("draws a chip per item, with the command on hover", () => {
    const w = mount(LaunchChipList, { props: { heading: "or run a script", icon: "play_arrow", chips: CHIPS } });
    const chips = w.findAll('[data-testid="cell-script-item"]');
    expect(chips.map((c) => c.text())).toEqual(["play_arrow build", "play_arrow test"]);
    expect(chips[1].attributes("title")).toBe("yarn test");
    expect(w.text()).toContain("or run a script");
  });

  // The row is one of several stacked under the directory field: an empty one must take no space
  // and show no heading for a list that isn't there.
  it("draws nothing at all when there is nothing to offer", () => {
    const w = mount(LaunchChipList, { props: { heading: "or launch", icon: "rocket_launch", chips: [] } });
    expect(w.find("div").exists()).toBe(false);
  });

  // The index, not the key: the caller maps it back to its own list, whose entries carry a server
  // allowlist position that is not this component's business.
  it("reports which chip was clicked by position", async () => {
    const w = mount(LaunchChipList, { props: { heading: "or launch", icon: "rocket_launch", chips: CHIPS } });
    await w.findAll('[data-testid="cell-script-item"]')[1].trigger("click");
    expect(w.emitted("pick")).toEqual([[1]]);
  });
});
