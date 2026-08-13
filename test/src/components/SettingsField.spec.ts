import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsField from "../../../src/components/SettingsField.vue";

// The v-model contract of the settings modal's shared text input. It used to be written inline in
// the template, where the cast to HTMLInputElement was invisible to the assertion ban (#1339); the
// narrowing moved into <script>, and what must not have moved with it is the emit itself.
describe("SettingsField", () => {
  it("emits every keystroke as update:modelValue", async () => {
    const w = mount(SettingsField, { props: { modelValue: "before" } });
    const input = w.get("input");
    await input.setValue("after");
    expect(w.emitted("update:modelValue")).toEqual([["after"]]);
  });

  it("shows the value it is given rather than its own", () => {
    const w = mount(SettingsField, { props: { modelValue: "from the parent" } });
    expect(w.get("input").element.value).toBe("from the parent");
  });
});
