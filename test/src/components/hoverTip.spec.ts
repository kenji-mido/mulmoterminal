// The hover tip end to end (#1235): a chip is hovered, the one shared tip shows what that chip
// could not fit, and nothing about it is deferred.
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import HoverTip from "../../../src/components/HoverTip.vue";
import WorkItemChip from "../../../src/components/WorkItemChip.vue";
import GitBranchChip from "../../../src/components/GitBranchChip.vue";
import CockpitHeader from "../../../src/components/CockpitHeader.vue";
import { hideHoverTip, showHoverTip, HOVER_TIP_ID } from "../../../src/composables/useHoverTip";
import type { TipContent } from "../../../src/components/tipContent";
import { EMPTY_WORK_ITEM, type WorkItem } from "../../../common/prPhase";
import type { GitStatus } from "../../../common/gitStatus";

const work = (over: Partial<WorkItem>): WorkItem => ({ ...EMPTY_WORK_ITEM, ...over });

const tipEl = () => document.querySelector('[data-testid="hover-tip"]');
const tipText = () => tipEl()?.textContent ?? "";

// The tip is teleported to <body>, so it outlives a wrapper unmount unless it is closed.
beforeEach(() => hideHoverTip());

describe("hovering a work chip", () => {
  it("shows the PR and issue titles the chip has no room for", async () => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, {
      props: { item: work({ phase: "ci-running", pr: 2689, prTitle: "経路A/Bの分離実装", issue: 2688, issueTitle: "セッション復元が2経路" }) },
    });

    expect(tipEl()).toBeNull(); // nothing before the pointer arrives
    await chip.get('[data-testid="work-chip"]').trigger("pointerenter");
    await nextTick();

    expect(tipText()).toContain("PR #2689 · CI running");
    expect(tipText()).toContain("経路A/Bの分離実装");
    expect(tipText()).toContain("issue #2688");
    expect(tipText()).toContain("セッション復元が2経路");
  });

  it("closes when the pointer leaves", async () => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, { props: { item: work({ phase: "ready", pr: 977 }) } });
    await chip.get('[data-testid="work-chip"]').trigger("pointerenter");
    await nextTick();
    expect(tipEl()).not.toBeNull();

    await chip.get('[data-testid="work-chip"]').trigger("pointerleave");
    await nextTick();
    expect(tipEl()).toBeNull();
  });

  // The chip's numbers are links, so a keyboard user reaches them — and would otherwise be the one
  // person who never sees what the PR is.
  it("shows on focus too, not only on hover", async () => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, { props: { item: work({ phase: "ready", pr: 977, prTitle: "a pull request" }) } });
    await chip.get('[data-testid="work-chip"]').trigger("focusin");
    await nextTick();
    expect(tipText()).toContain("a pull request");
  });

  // Removing `title` takes the text away from assistive tech unless something replaces it.
  it("points at the tip with aria-describedby, and only while its own tip is up", async () => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, { props: { item: work({ phase: "ready", pr: 977 }) } });
    const el = chip.get('[data-testid="work-chip"]');
    expect(el.attributes("aria-describedby")).toBeUndefined();

    await el.trigger("pointerenter");
    expect(el.attributes("aria-describedby")).toBe(HOVER_TIP_ID);

    await el.trigger("pointerleave");
    expect(el.attributes("aria-describedby")).toBeUndefined();
  });
});

// The roster row is a SEPARATE component, not a TerminalCell (docs/grid-view-modes.md), so wiring
// the cell's chips leaves it untouched — the trap that doc exists to warn about. Asserted here so
// "the header has instant tips" cannot be true in two view modes and false in the third.
describe("the cockpit roster row", () => {
  it("opens the tip from its own phase pill and path", async () => {
    mount(HoverTip);
    const row = mount(CockpitHeader, {
      props: {
        status: "working",
        agent: "claude",
        cwd: "/home/me/work/nested/deep/proj",
        home: "/home/me",
        headerColor: null,
        headerTextColor: null,
        phase: "ci-running",
      },
    });

    await row.get('[data-testid="cockpit-phase"]').trigger("pointerenter");
    await nextTick();
    expect(tipText()).toContain("PR — CI running");

    await row.get('[data-testid="cockpit-phase"]').trigger("pointerleave");
    await row.get('[data-testid="cockpit-dir"]').trigger("pointerenter");
    await nextTick();
    expect(tipText()).toBe("/home/me/work/nested/deep/proj");
  });
});

// Codex, on this PR. HoverTip closes on scroll / resize / pointerdown — events the CHIP never
// hears — so an anchor that REMEMBERED being described kept pointing `aria-describedby` at an
// element no longer in the document, and a screen reader looked up nothing. Its own describe
// block: this is about the layer's closing paths, not about any one chip.
describe("closing the tip from outside the chip", () => {
  it.each(["scroll", "resize", "pointerdown"])("drops aria-describedby when a %s closes it", async (event) => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, { props: { item: work({ phase: "ready", pr: 977 }) } });
    const el = chip.get('[data-testid="work-chip"]');
    await el.trigger("pointerenter");
    expect(el.attributes("aria-describedby")).toBe(HOVER_TIP_ID);

    window.dispatchEvent(new Event(event));
    await nextTick();

    expect(tipEl()).toBeNull();
    expect(el.attributes("aria-describedby")).toBeUndefined();
  });
});

describe("the shared tip", () => {
  // One element, whichever chip opened it: a per-chip tooltip can leave the previous one on screen
  // when the pointer crosses straight from one chip to the next.
  it("is a single element that changes content between chips", async () => {
    mount(HoverTip);
    const chip = mount(WorkItemChip, { props: { item: work({ phase: "ready", pr: 977 }) } });
    const branch = mount(GitBranchChip, {
      props: { status: { repo: true, branch: "fix/1235-instant-header-tips", detached: false, dirty: 2, ahead: 0, behind: 0, upstream: true } as GitStatus },
    });

    await chip.get('[data-testid="work-chip"]').trigger("pointerenter");
    await nextTick();
    expect(tipText()).toContain("PR #977");

    // Leaving the first fires BEFORE entering the second, which is the ordering the singleton
    // relies on — assert the end state has one tip holding the second chip's content.
    await chip.get('[data-testid="work-chip"]').trigger("pointerleave");
    await branch.get('[data-testid="git-chip"]').trigger("pointerenter");
    await nextTick();

    expect(document.querySelectorAll('[data-testid="hover-tip"]')).toHaveLength(1);
    expect(tipText()).toContain("branch fix/1235-instant-header-tips");
    expect(tipText()).toContain("2 uncommitted");
    expect(tipText()).not.toContain("PR #977");
  });

  // Empty content means "nothing worth saying" and must not open an empty panel. Asserted on the
  // layer rather than through a chip: every chip that RENDERS today also has something to say
  // (a chip with no repo, no work item and no name does not render at all), so a component-level
  // version of this would be theatre. This is the guard that keeps that true as builders change.
  it("does not open for content with no sections", async () => {
    mount(HoverTip);
    // A real dispatch rather than a hand-built object: `currentTarget` is what the handler reads,
    // and it is only ever set by an actual dispatch.
    const el = document.createElement("span");
    document.body.appendChild(el);
    const enter = (content: TipContent): boolean => {
      let opened = false;
      const handler = (event: Event) => {
        opened = showHoverTip(event, content);
      };
      el.addEventListener("pointerenter", handler);
      el.dispatchEvent(new Event("pointerenter"));
      el.removeEventListener("pointerenter", handler);
      return opened;
    };

    expect(enter([])).toBe(false);
    await nextTick();
    expect(tipEl()).toBeNull();

    expect(enter([{ head: "something" }])).toBe(true);
    await nextTick();
    expect(tipText()).toContain("something");
    el.remove();
  });
});
