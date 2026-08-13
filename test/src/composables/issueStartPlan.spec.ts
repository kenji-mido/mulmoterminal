// What the issue row's start control can do — three outcomes, each a different thing for the
// user to see, so each is pinned rather than left to the component.
import { describe, it, expect } from "vitest";
import { issueStartPlan, issueStartBlockedReason } from "../../../src/composables/issueStartPlan";
import type { RepoDirs } from "../../../common/repoDirs";

const entry = (paths: string[], primary: string | null = null): RepoDirs => ({
  repo: "acme/web",
  dirs: paths.map((path) => ({ path, label: path.split("/").pop() ?? path, orderPriority: null })),
  primary,
});

describe("issueStartPlan", () => {
  // A repo the user watches but has never cloned. There is nowhere for the work to happen, and
  // the control must say so rather than fail on click.
  it.each([
    ["a repo absent from the answer", undefined],
    ["a repo with an empty candidate list", entry([])],
  ])("is no-clone for %s", (_case, value) => {
    expect(issueStartPlan(value)).toEqual({ kind: "no-clone" });
  });

  it("is ready with the only candidate when the repo has one clone", () => {
    expect(issueStartPlan(entry(["/w/web"]))).toEqual({ kind: "ready", dir: "/w/web" });
  });

  it("is ready with the recorded choice when there are several", () => {
    expect(issueStartPlan(entry(["/w/web", "/w/web2"], "/w/web2"))).toEqual({ kind: "ready", dir: "/w/web2" });
  });

  // Treating a recorded single clone the same as an unrecorded one keeps "recorded" from being a
  // state the component has to tell apart — it is the same answer either way.
  it("is ready when a single clone is also the recorded one", () => {
    expect(issueStartPlan(entry(["/w/web"], "/w/web"))).toEqual({ kind: "ready", dir: "/w/web" });
  });

  it("asks which clone when there are several and nothing is recorded", () => {
    const plan = issueStartPlan(entry(["/w/web", "/w/web2", "/w/web3"]));
    expect(plan.kind).toBe("choose");
    expect(plan.kind === "choose" && plan.dirs.map((d) => d.path)).toEqual(["/w/web", "/w/web2", "/w/web3"]);
  });
});

describe("issueStartBlockedReason", () => {
  it("names the repo, and says what to do about it", () => {
    const reason = issueStartBlockedReason({ kind: "no-clone" }, "acme/web");
    expect(reason).toContain("acme/web");
    expect(reason).toContain("directory presets");
  });

  it.each([
    ["ready", { kind: "ready" as const, dir: "/w/web" }],
    ["choose", { kind: "choose" as const, dirs: entry(["/w/a", "/w/b"]).dirs }],
  ])("is null for %s", (_case, plan) => {
    expect(issueStartBlockedReason(plan, "acme/web")).toBeNull();
  });
});
