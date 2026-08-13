// When a cell offers to tidy itself up, and — more importantly — when it must not. The prompt is
// the only handle left on a finished worktree cell (the work-item chip hides at `merged`), so it
// has to appear reliably; and it interrupts, so every case that would nag is pinned too.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { shouldPromptTidy, type TidyPromptState } from "../../../src/components/mergedTidy";
import CellTidyPrompt from "../../../src/components/CellTidyPrompt.vue";
import { PR_PHASES, type PrPhase } from "../../../common/prPhase";

const state = (over: Partial<TidyPromptState> = {}): TidyPromptState => ({ phase: "merged", pr: 1180, isWorktree: true, dismissedPr: null, ...over });

describe("shouldPromptTidy", () => {
  it("offers on a worktree cell whose PR has merged", () => {
    expect(shouldPromptTidy(state())).toBe(true);
  });

  // Nothing to tidy: an ordinary cell has no room to remove, so a prompt there would lead to a
  // confirmation that cannot do anything.
  it("does not offer on a cell that is not a worktree", () => {
    expect(shouldPromptTidy(state({ isWorktree: false }))).toBe(false);
  });

  it.each(PR_PHASES.filter((p) => p !== "merged"))("does not offer while the phase is %s", (phase: PrPhase) => {
    expect(shouldPromptTidy(state({ phase }))).toBe(false);
  });

  // The prompt names the PR. "merged" with no number would be a claim the cell cannot back up.
  it("does not offer when there is no PR number to name", () => {
    expect(shouldPromptTidy(state({ pr: null }))).toBe(false);
  });

  it("stays away once dismissed for that PR", () => {
    expect(shouldPromptTidy(state({ dismissedPr: 1180 }))).toBe(false);
  });

  // Keyed to the PR, so a cell reused for the next piece of work asks again instead of going quiet
  // forever after one dismissal.
  it("offers again when a different PR merges in the same cell", () => {
    expect(shouldPromptTidy(state({ pr: 1181, dismissedPr: 1180 }))).toBe(true);
  });
});

describe("CellTidyPrompt", () => {
  it("names the PR and offers both actions", () => {
    const w = mount(CellTidyPrompt, { props: { pr: 1180 } });
    expect(w.get('[data-testid="cell-tidy-open"]').text()).toContain("#1180 merged");
    expect(w.find('[data-testid="cell-tidy-dismiss"]').exists()).toBe(true);
  });

  // Two separate events, because they are opposite intents and the cell wires them to opposite
  // things — one opens the keep-or-remove confirmation, the other silences the prompt.
  it.each([
    ["cell-tidy-open", "tidy"],
    ["cell-tidy-dismiss", "dismiss"],
  ])("%s emits %s", async (testid, event) => {
    const w = mount(CellTidyPrompt, { props: { pr: 1180 } });
    await w.get(`[data-testid="${testid}"]`).trigger("click");
    expect(w.emitted(event)).toHaveLength(1);
    expect(w.emitted(event === "tidy" ? "dismiss" : "tidy")).toBeUndefined();
  });
});
