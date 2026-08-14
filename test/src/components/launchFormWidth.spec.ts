import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CellLaunchForm from "../../../src/components/CellLaunchForm.vue";
import LaunchChipList from "../../../src/components/LaunchChipList.vue";
import ModelPicker from "../../../src/components/ModelPicker.vue";
import { LAUNCH_ROW } from "../../../src/components/launchFormClasses";
import type { AgentPick } from "../../../common/customAgents";

// The form is a capped column with ONE row let out of it. That asymmetry is the whole point and is
// invisible from either side alone: the directory chips tile, so 25 of them inside the old 360px cap
// wrapped into 20 rows while the cell was 1535px wide, while the controls below gain nothing from
// the width and lose the checkbox to the far edge of the screen (#1455).
const PIXEL_CAP = /^max-w-\[\d+px\]$/;
const capOf = (classes: string[]): string | undefined => classes.find((c) => PIXEL_CAP.test(c));

describe("the launch form takes the cell's width", () => {
  beforeEach(() => {
    // A worktree and a session, because their two rows render only once those fetches land — the
    // form's initial DOM has neither, so asserting on it would quietly cover fewer rows than the
    // test claims (CodeRabbit on #1455).
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees"))
        return {
          ok: true,
          json: async () => ({ isGit: true, base: "main", worktrees: [{ path: "/repo/../wt", branch: "fix-login", task: "fix-login", dirty: false }] }),
        };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [{ id: "s1", title: "a session", mtime: 1 }] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  const mountForm = async () => {
    const w = mount(CellLaunchForm, {
      props: {
        dir: "/repo",
        agent: "claude" as AgentPick,
        choice: null,
        defaultCwd: "/home/me/ws",
        presets: [{ label: "repo", path: "/repo" }],
        openSessionIds: [],
      },
    });
    await flushPromises();
    return w;
  };

  // Without this the file stops guarding the moment LAUNCH_ROW drops its cap: every assertion below
  // is derived from that constant, so all four would keep passing over a form with no cap at all
  // (Codex on #1460).
  it("keeps a pixel cap in the row class the controls share", () => {
    expect(capOf(LAUNCH_ROW.split(" "))).toMatch(PIXEL_CAP);
  });

  // The one row let out of the cap, and the reason the cap was worth revisiting at all. Asked of the
  // class list directly rather than against LAUNCH_ROW's value, so the chips are pinned as uncapped
  // whatever the controls settle on.
  it("lets the directory chips span the whole cell", async () => {
    const w = await mountForm();
    const chipRow = w.get('[data-testid="cell-chip"]').element.parentElement;
    expect([...(chipRow?.classList ?? [])]).toContain("w-full");
    expect(capOf([...(chipRow?.classList ?? [])])).toBeUndefined();
  });

  // Every other row shares one width, so the column stays a column. The agent picker is content-
  // sized on top of that: it is a segmented control, and stretching it would widen the pill's
  // background rather than fit anything into it.
  it("holds every control to one width, and leaves the agent picker its own", async () => {
    const w = await mountForm();
    // The two rows that arrive with the fetches, named so a fixture that stops producing them
    // fails here rather than silently shrinking what the loop below walks.
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-resume"]').exists()).toBe(true);

    const rows = [...w.get('[data-testid="cell-launch"]').element.children].filter((el) => el.getAttribute("data-testid") !== "cell-launch-cancel");
    const picker = rows.find((el) => el.getAttribute("data-testid") === "agent-picker");
    const chipRow = w.get('[data-testid="cell-chip"]').element.parentElement;
    // classList, not a substring of the class string: "max-w-full" contains "w-full".
    expect([...(picker?.classList ?? [])]).toContain("max-w-full");
    expect([...(picker?.classList ?? [])]).not.toContain("w-full");

    // The directory field, the model picker, and the two rows named above. A smaller number means
    // the fixture stopped rendering something and the loop below is checking less than it reads as.
    const capped = rows.filter((el) => el !== picker && el !== chipRow);
    expect(capped.length).toBeGreaterThanOrEqual(4);
    capped.forEach((el) => LAUNCH_ROW.split(" ").forEach((cls) => expect([...el.classList]).toContain(cls)));
  });

  it("holds the chip lists it stacks to the same width", () => {
    const w = mount(LaunchChipList, {
      props: { heading: "or run a script", icon: "play_arrow", chips: [{ key: 0, label: "build", title: "yarn build" }] },
    });
    LAUNCH_ROW.split(" ").forEach((cls) => expect(w.get("div").classes()).toContain(cls));
  });

  // The picker's WRAPPER is what this file is about — the row the form stacks. The `<select>` inside
  // it takes its width from SELECT_CONTROL, which every select in the app shares, so pinning it from
  // here would tie one launch-form test to a decision made for the whole app.
  it("holds the model picker's row to the same width", () => {
    const w = mount(ModelPicker, { props: { modelValue: null } });
    LAUNCH_ROW.split(" ").forEach((cls) => expect(w.get("div").classes()).toContain(cls));
  });
});
