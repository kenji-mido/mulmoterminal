import { describe, it, expect } from "vitest";
import { WORKTREE_LAUNCH_IN_FLIGHT, worktreeAction, worktreeLimitReason, worktreeRefusal } from "../../common/worktreeSession";

describe("worktreeAction", () => {
  it("starts a session in a worktree that has none", () => {
    expect(worktreeAction(null)).toBe("start");
  });

  it("resumes the session a worktree already has", () => {
    expect(worktreeAction({ attached: false })).toBe("resume");
  });

  // The whole point: a worktree whose session somebody is holding must not hand it over, and must
  // not start a second agent in the same working tree either (#1207).
  it("refuses a worktree whose session is held", () => {
    expect(worktreeAction({ attached: true })).toBe("busy");
  });

  // A page left open across an upgrade parses rows from a server that never sent the field. It
  // behaves as every worktree row did before this existed, rather than refusing all of them.
  it("starts when the server said nothing", () => {
    expect(worktreeAction(undefined)).toBe("start");
  });
});

// The launcher greys a control out and the server closes the socket; both quote this, so a user who
// meets the rule from either side is told the same thing — including what to do instead.
describe("worktreeLimitReason", () => {
  it("names the other terminal when someone is holding the session", () => {
    expect(worktreeLimitReason({ attached: true })).toContain("open in another terminal");
  });

  it("points at the row when the session is merely there", () => {
    expect(worktreeLimitReason({ attached: false })).toContain("resume it from its row");
  });

  it("says one session either way", () => {
    for (const attached of [true, false]) expect(worktreeLimitReason({ attached })).toMatch(/one session|a second one/);
  });
});

// Two grounds for one refusal: a session that is already there, and one still on its way (two
// launches aimed at the same worktree, the second arriving mid-spawn — the race Codex found).
describe("worktreeRefusal", () => {
  it("does not refuse a free worktree", () => {
    expect(worktreeRefusal(null, false)).toBeNull();
  });

  it("refuses while another launch is still starting", () => {
    expect(worktreeRefusal(null, true)).toBe(WORKTREE_LAUNCH_IN_FLIGHT);
  });

  // An existing session is the more specific answer, and the one that tells the reader what to do
  // about it, so it wins over the in-flight wording when both are true.
  it("names the session that is already there, even mid-launch", () => {
    expect(worktreeRefusal({ attached: true }, true)).toBe(worktreeLimitReason({ attached: true }));
    expect(worktreeRefusal({ attached: false }, false)).toBe(worktreeLimitReason({ attached: false }));
  });
});
