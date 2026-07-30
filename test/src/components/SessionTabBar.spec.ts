// The app builds Tailwind WITHOUT preflight (src/tailwind.css), so a <button> that sets no
// bg-* utility falls back to the UA's ButtonFace — a light grey pill. The idle history tabs
// did exactly that: light-grey button under text-secondary, unreadable on every dark theme.
// A visual-only defect, so nothing else here can catch it; this pins the explicit background
// on BOTH tab states.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SessionTabBar from "../../../src/components/SessionTabBar.vue";
import type { Session } from "../../../src/composables/useSessions";

function session(id: string, over: Partial<Session> = {}): Session {
  return { id, title: `session ${id}`, mtime: 1, working: false, waiting: false, ...over };
}

function mountBar(activeId: string | null) {
  return mount(SessionTabBar, {
    props: { sessions: [session("a"), session("b")], activeId, filter: "all" as const },
  });
}

describe("SessionTabBar tab background", () => {
  it("gives every tab an explicit background, active or not", () => {
    const tabs = mountBar("a").findAll("button[title^='session']");
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      // Not `hover:bg-*`, which leaves the resting state to the UA.
      const resting = tab.classes().filter((c) => /^bg-/.test(c));
      expect(resting, `tab ${tab.attributes("title")} has no resting bg-* utility`).not.toEqual([]);
    }
  });

  it("sets exactly one bg-* per tab, so two fills never compete", () => {
    for (const activeId of ["a", null]) {
      for (const tab of mountBar(activeId).findAll("button[title^='session']")) {
        expect(tab.classes().filter((c) => /^bg-/.test(c))).toHaveLength(1);
      }
    }
  });

  // Which fill lands on which tab, not just that both have one — the checks above would be
  // satisfied by giving the idle tabs bg-subtle too, which reads as "everything is selected".
  it("fills only the active tab, and leaves the rest showing the bar through", () => {
    const bar = mountBar("a");
    expect(bar.find("button[title='session a']").classes()).toContain("bg-subtle");
    expect(bar.find("button[title='session b']").classes()).toContain("bg-transparent");
    // The idle tab still lights up under the cursor; bg-transparent must not have replaced that.
    expect(bar.find("button[title='session b']").classes()).toContain("hover:bg-subtle");
  });
});

// #1139: the tab's unread dot was `--err-strong` red for BOTH "stopped on a prompt" and "finished,
// unread" — and a finished turn is not an error. It now takes the hue from the shared rule.
describe("SessionTabBar attention dot", () => {
  const bar = (sessions: Session[], activeId: string | null = null) => mount(SessionTabBar, { props: { sessions, activeId, filter: "all" as const } });

  it("is amber while stopped on a prompt and green once finished", () => {
    const w = bar([session("a", { waiting: true, event: "Notification" }), session("b", { waiting: true, event: "Stop" })]);
    const dots = w.findAll('[data-testid="tab-dot"]');
    expect(dots).toHaveLength(2);
    expect(dots[0].classes().join(" ")).toContain("bg-[#f59e0b]");
    expect(dots[0].attributes("aria-label")).toBe("Waiting for you");
    expect(dots[0].attributes("role")).toBe("img"); // the label is only a name with a role on it

    expect(dots[1].classes().join(" ")).toContain("bg-[#22c55e]");
    expect(dots[1].attributes("aria-label")).toBe("Finished — unread");
  });

  it("shows no dot on the tab you are already looking at, or on a quiet one", () => {
    const w = bar([session("a", { waiting: true, event: "Notification" }), session("b")], "a");
    expect(w.findAll('[data-testid="tab-dot"]')).toHaveLength(0);
  });

  // The red was carrying an error's weight. Nothing should reintroduce it here.
  it("no longer uses the error colour", () => {
    const w = bar([session("a", { waiting: true, event: "Stop" })]);
    expect(w.get('[data-testid="tab-dot"]').classes().join(" ")).not.toContain("err-strong");
  });
});

// Same gate as the sidebar and the bold: a background worker is never marked (isUnread excludes it).
describe("SessionTabBar background workers", () => {
  it("shows no dot for a hidden row, however it is waiting", () => {
    const w = mount(SessionTabBar, {
      props: { sessions: [session("a", { waiting: true, event: "Notification", hidden: true })], activeId: null, filter: "background" as const },
    });
    expect(w.findAll('[data-testid="tab-dot"]')).toHaveLength(0);
  });
});
