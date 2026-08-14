// Every cell-header chip declares its own font (#1251).
//
// This app sets no font-family on <body> — each element carries a utility instead — so a chip that
// declares none falls through to the browser's default, which is a SERIF. That is not a subtle
// difference next to the sans chips beside it, and it went unnoticed for a long time because
// nothing fails: it renders, it is the right size, it is just the wrong typeface. Measured in a
// real browser at the time of the fix; jsdom resolves no fonts, so the attribute is what can be
// pinned here.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GitBranchChip from "../../../src/components/GitBranchChip.vue";
import WorkItemChip from "../../../src/components/WorkItemChip.vue";
import DirBadge from "../../../src/components/DirBadge.vue";
import ModelContextBadge from "../../../src/components/ModelContextBadge.vue";
import { EMPTY_WORK_ITEM } from "../../../common/prPhase";
import type { GitStatus } from "../../../common/gitStatus";

const gitStatus: GitStatus = { repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: true } as GitStatus;

// A chip may be sans or mono — what it may NOT be is silent, which is what leaves it serif.
const FONT_CLASS = /^font-(sans|mono)$/;

const chips = [
  ["git branch", () => mount(GitBranchChip, { props: { status: gitStatus } }), '[data-testid="git-chip"]'],
  ["work item", () => mount(WorkItemChip, { props: { item: { ...EMPTY_WORK_ITEM, phase: "ready", pr: 977 } } }), '[data-testid="work-chip"]'],
  ["dir badge", () => mount(DirBadge, { props: { name: "demo", color: null } }), "span"],
  [
    "model / context",
    () => mount(ModelContextBadge, { props: { agent: "claude", model: "claude-opus-4-20250514", contextTokens: 1000, contextWindow: null } }),
    '[data-testid="model-badge"]',
  ],
] as const;

describe("cell-header chips", () => {
  it.each(chips)("%s declares a font rather than inheriting the browser's serif", (_name, mountChip, selector) => {
    expect(
      mountChip()
        .get(selector)
        .classes()
        .some((c) => FONT_CLASS.test(c)),
    ).toBe(true);
  });
});
