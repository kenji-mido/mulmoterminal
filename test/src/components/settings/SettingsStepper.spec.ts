import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsStepper from "../../../../src/components/settings/SettingsStepper.vue";

// Shared by the two numeric Settings sections (terminal font size, terminal scroll speed). The
// contract worth pinning is what the caller relies on: the emitted delta is SIGNED, so the
// caller's nudge function takes it as-is, and the ends of the range are unreachable rather than
// clamped after the fact.
const mountStepper = (props: Partial<{ value: number; unit: string; min: number; max: number; step: number; label: string }> = {}) =>
  mount(SettingsStepper, { props: { value: 14, unit: " px", min: 8, max: 32, step: 1, label: "terminal font size", ...props } });

const decrease = (w: ReturnType<typeof mountStepper>) => w.find('[aria-label="Decrease terminal font size"]');
const increase = (w: ReturnType<typeof mountStepper>) => w.find('[aria-label="Increase terminal font size"]');

describe("SettingsStepper", () => {
  it("names both buttons from the label", () => {
    const w = mountStepper();
    expect(decrease(w).exists()).toBe(true);
    expect(increase(w).exists()).toBe(true);
  });

  it("emits the step signed by which button was pressed", async () => {
    const w = mountStepper({ step: 2 });
    await increase(w).trigger("click");
    expect(w.emitted("nudge")?.at(-1)?.[0]).toBe(2);
    await decrease(w).trigger("click");
    expect(w.emitted("nudge")?.at(-1)?.[0]).toBe(-2);
  });

  it("shows the value with its unit appended as given", () => {
    expect(mountStepper({ value: 14, unit: " px" }).text()).toContain("14 px");
    expect(mountStepper({ value: 1.5, unit: "×", label: "terminal scroll speed" }).text()).toContain("1.5×");
  });

  it("disables the end of the range it is already at", () => {
    const atMin = mountStepper({ value: 8 });
    expect(decrease(atMin).attributes("disabled")).toBe("");
    expect(increase(atMin).attributes("disabled")).toBeUndefined();

    const atMax = mountStepper({ value: 32 });
    expect(increase(atMax).attributes("disabled")).toBe("");
    expect(decrease(atMax).attributes("disabled")).toBeUndefined();
  });

  // A value already outside the range — a config edited by hand, a stored value from an older
  // build with a wider range — must not offer the button that pushes it further out.
  it("disables past the end, not only at it", () => {
    expect(decrease(mountStepper({ value: 4 })).attributes("disabled")).toBe("");
    expect(increase(mountStepper({ value: 40 })).attributes("disabled")).toBe("");
  });

  // The readout is what a screen reader announces after a press, so it has to be live.
  it("announces the value politely", () => {
    expect(mountStepper().find('[aria-live="polite"]').text()).toContain("14 px");
  });
});
