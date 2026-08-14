import { describe, it, expect } from "vitest";

import { flipTargetUid, shouldFlipZoom, worktreeFailureMessage, worktreeRequestFailure } from "../../../src/components/cellChromeRules";

describe("worktreeFailureMessage", () => {
  it.each([
    ["not-worktree", "Not a worktree"],
    ["no-branch", "No branch to push"],
    ["push-failed", "Push failed"],
  ])("explains %s", (reason, expected) => {
    expect(worktreeFailureMessage(reason)).toBe(expected);
  });

  // The push half succeeded — the message has to say so, or the user re-pushes. It must NOT say
  // "not a GitHub repo": since #981 this reason covers any forge we cannot open a request on, and
  // naming GitHub told a GitLab user something both wrong and useless.
  it("tells the user their push landed even though the request did not", () => {
    const message = worktreeFailureMessage("no-forge");
    expect(message.toLowerCase()).toContain("push succeeded");
    expect(message).not.toContain("GitHub");
  });

  it.each([[undefined], [null], [""], ["something-new"]])("falls back to a plain failure for %j", (reason) => {
    expect(worktreeFailureMessage(reason)).toBe("Failed");
  });

  // A reason arrives inside a server response, so a plain object literal would answer these
  // through its prototype chain — and `??` does not catch a function, so the UI would render
  // "function Object() { [native code] }" where a sentence belongs.
  it.each([["constructor"], ["toString"], ["__proto__"], ["hasOwnProperty"]])("does not resolve %s through the prototype chain", (reason) => {
    expect(worktreeFailureMessage(reason)).toBe("Failed");
  });
});

// The worktree routes refuse in two shapes and the sentence naming the cause lives in a different
// key in each. Reading only one of them is how #1549's create failure showed nothing at all.
describe("worktreeRequestFailure", () => {
  it("prefers the server's own sentence", () => {
    expect(worktreeRequestFailure({ error: "fatal: Not a valid object name: 'main'." }, 500)).toBe("fatal: Not a valid object name: 'main'.");
  });

  it("explains a `reason` refusal in words", () => {
    expect(worktreeRequestFailure({ ok: false, reason: "dirty" }, 409)).toContain("uncommitted changes");
    expect(worktreeRequestFailure({ ok: false, reason: "not-managed" }, 409)).toContain("MulmoTerminal created");
  });

  // A body absorbed into `{}` (a 403 from the origin guard, a truncated response) still has to say
  // that the click FAILED — the whole point is that silence is indistinguishable from doing nothing.
  it.each([[{}], [{ error: "" }], [{ reason: 42 }]])("names the status when the body says nothing usable: %j", (body) => {
    expect(worktreeRequestFailure(body, 403)).toContain("403");
  });
});

describe("flipTargetUid", () => {
  it("flies the cell being zoomed in", () => {
    expect(flipTargetUid(3, null)).toBe(3);
  });

  it("flies the cell being zoomed out", () => {
    expect(flipTargetUid(null, 3)).toBe(3);
  });

  it("has nothing to fly when neither end names a cell", () => {
    expect(flipTargetUid(null, null)).toBeNull();
    expect(flipTargetUid(undefined, undefined)).toBeNull();
  });

  // uid 0 is a real cell, and `??` is what keeps it from being read as "none".
  it("treats cell 0 as a cell", () => {
    expect(flipTargetUid(0, null)).toBe(0);
    expect(flipTargetUid(null, 0)).toBe(0);
  });
});

describe("shouldFlipZoom", () => {
  it("animates a zoom in and a zoom out", () => {
    expect(shouldFlipZoom(3, null, false)).toBe(true);
    expect(shouldFlipZoom(null, 3, false)).toBe(true);
  });

  // Swapping between two already-zoomed cells has no on-screen source to fly from — the
  // incoming cell sits off-screen in the grid — so the animation would start from nowhere.
  it("skips a swap between two zoomed cells", () => {
    expect(shouldFlipZoom(4, 3, false)).toBe(false);
  });

  it("respects a reduced-motion preference", () => {
    expect(shouldFlipZoom(3, null, true)).toBe(false);
  });

  it("does nothing when there is no cell at either end", () => {
    expect(shouldFlipZoom(null, null, false)).toBe(false);
  });
});
