import { describe, it, expect } from "vitest";
import { activityStatus } from "../../../src/components/attentionStatus";

// Moved here with the function itself (#1139): the grid was its only reader while it lived in
// gridTabs, and the sidebar and tab bar now read the same rule.
describe("activityStatus", () => {
  it("splits waiting into blocked (Notification) vs done (Stop)", () => {
    expect(activityStatus(false, true, "Notification")).toBe("blocked");
    expect(activityStatus(false, true, "Stop")).toBe("done");
    expect(activityStatus(false, true, null)).toBe("done"); // any non-Notification waiting -> done
  });
  it("is working when only working, idle when neither", () => {
    expect(activityStatus(true, false, "UserPromptSubmit")).toBe("working");
    expect(activityStatus(false, false, null)).toBe("idle");
  });
  it("waiting wins over working (a permission pause mid-turn is blocked)", () => {
    expect(activityStatus(true, true, "Notification")).toBe("blocked");
  });
  // An agent too old to send an event, or a hook we do not model, must not read as "stuck": done is
  // the claim that costs less when wrong.
  it("treats an unknown waiting event as done rather than blocked", () => {
    expect(activityStatus(false, true, undefined)).toBe("done");
    expect(activityStatus(false, true, "SomethingNew")).toBe("done");
  });
});
