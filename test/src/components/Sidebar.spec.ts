import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "../../../src/components/Sidebar.vue";
import type { Session, Filter } from "../../../src/composables/useSessions";

// Sidebar is now presentational: App.vue owns the list + filter and passes them
// in. These tests drive it purely through props/emits.

function row(over: Partial<Session> & { id: string }): Session {
  return { title: over.id, mtime: 1, working: false, waiting: false, ...over };
}

function mountSidebar(over: { sessions: Session[]; activeId?: string | null; filter?: Filter }) {
  return mount(Sidebar, {
    props: {
      sessions: over.sessions,
      loading: false,
      error: null,
      activeId: over.activeId ?? null,
      filter: over.filter ?? "all",
    },
  });
}

describe("Sidebar", () => {
  it("renders sessions and shows the working spinner", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", title: "Alpha", working: true }), row({ id: "b", title: "Beta" })],
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Alpha");
    // Only the working session shows the spinner.
    expect(items[0].find('[data-testid="session-spinner"]').exists()).toBe(true);
    expect(items[1].find('[data-testid="session-spinner"]').exists()).toBe(false);
  });

  it("bolds a waiting session via the .waiting class", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b", waiting: false })],
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items[0].classes()).toContain("waiting");
    expect(items[1].classes()).not.toContain("waiting");
  });

  // #1139: bold said "wants you" for two states that mean different things — one is stopped until
  // you answer, the other is just unread. The dot's hue is which.
  it("marks a blocked row amber and a finished row green, in the spinner's slot", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true, event: "Notification" }), row({ id: "b", waiting: true, event: "Stop" }), row({ id: "c", working: true })],
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    const blocked = items[0].get('[data-testid="session-dot"]');
    expect(blocked.classes().join(" ")).toContain("bg-[#f59e0b]");
    expect(blocked.attributes("aria-label")).toBe("Waiting for you");
    // An aria-label on a bare <span> is not exposed as a name by much of AT; the role is what makes
    // it one (CodeRabbit).
    expect(blocked.attributes("role")).toBe("img");
    const done = items[1].get('[data-testid="session-dot"]');
    expect(done.classes().join(" ")).toContain("bg-[#22c55e]");
    expect(done.attributes("aria-label")).toBe("Finished — unread");
    // A working row keeps the spinner and takes no dot: one slot, and the states are exclusive.
    expect(items[2].find('[data-testid="session-spinner"]').exists()).toBe(true);
    expect(items[2].find('[data-testid="session-dot"]').exists()).toBe(false);
  });

  // The dot is gated by isUnread, which excludes background workers — same population as the bold
  // and the Unread chip. A dot on a row with no bold would be the contradiction this fixes.
  it("leaves a background worker unmarked even when it is waiting", () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a", waiting: true, event: "Notification", hidden: true })], filter: "background" });
    expect(wrapper.find('[data-testid="session-dot"]').exists()).toBe(false);
  });

  it("gives an idle row no dot at all", () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a" })] });
    expect(wrapper.find('[data-testid="session-dot"]').exists()).toBe(false);
  });

  it("hides the spinner while a session is waiting for input", () => {
    // A waiting session keeps `working` true server-side, but it is blocked on
    // the user — spinning there reads as "thinking", so suppress it.
    const wrapper = mountSidebar({ sessions: [row({ id: "a", working: true, waiting: true })] });
    const item = wrapper.find('[data-testid="session-item"]');
    expect(item.find('[data-testid="session-spinner"]').exists()).toBe(false);
    expect(item.classes()).toContain("waiting");
  });

  it("hides the spinner on the active session even while it is working", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", working: true }), row({ id: "b", working: true })],
      activeId: "a",
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items[0].find('[data-testid="session-spinner"]').exists()).toBe(false); // active
    expect(items[1].find('[data-testid="session-spinner"]').exists()).toBe(true); // background
  });

  it("shows only unread rows when the filter prop is 'unread'", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b", waiting: false })],
      filter: "unread",
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("a");
  });

  it("emits update:filter when an unread chip is clicked, with its count", async () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b" })],
    });
    const unreadChip = wrapper.findAll("[aria-pressed]")[1];
    expect(unreadChip.text()).toContain("(1)");
    await unreadChip.trigger("click");
    expect(wrapper.emitted("update:filter")?.[0]).toEqual(["unread"]);
  });

  // The behaviour the feature is for: a scheduled collection refresh must not sit in the
  // list the user reads, and must still be one click away (#1060).
  it("leaves background workers out of the default list", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "chat" }), row({ id: "refresh", hidden: true })],
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("chat");
  });

  it("shows only background workers under the background filter", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "chat" }), row({ id: "refresh", hidden: true })],
      filter: "background",
    });
    const items = wrapper.findAll('[data-testid="session-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("refresh");
  });

  it("emits update:filter when the background chip is clicked, with its count", async () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "chat" }), row({ id: "refresh", hidden: true })],
    });
    const backgroundChip = wrapper.findAll("[aria-pressed]")[2];
    expect(backgroundChip.text()).toContain("(1)");
    await backgroundChip.trigger("click");
    expect(wrapper.emitted("update:filter")?.[0]).toEqual(["background"]);
  });

  // No collections, no chip: an installation that never spawns a worker should not carry a
  // permanently empty filter.
  it("hides the background chip when there is nothing behind it", () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "chat" })] });
    expect(wrapper.findAll("[aria-pressed]")).toHaveLength(2);
  });

  // ...unless it is the chip in use — the last worker finishing must not pull the selected
  // filter out from under the user.
  it("keeps the background chip while it is the active filter", () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "chat" })], filter: "background" });
    const chips = wrapper.findAll("[aria-pressed]");
    expect(chips).toHaveLength(3);
    expect(chips[2].text()).toContain("Background");
    expect(wrapper.text()).toContain("No background sessions");
  });

  // A project whose only sessions are workers has rows to list and no chats; "No sessions
  // yet" would report that as an empty project.
  it("says which filter came up empty, not that the project has no sessions", () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "refresh", hidden: true })] });
    expect(wrapper.text()).toContain("No chat sessions");
    expect(wrapper.text()).not.toContain("No sessions yet");
  });

  it("emits refresh when the sort button is clicked", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a" })] });
    await wrapper.find('[aria-label="Sort by most recent"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("emits select with the session id + agent on click", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a", title: "Alpha" })] });
    await wrapper.find('[data-testid="session-item"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["a", "claude"]);
  });

  it("emits the codex agent + shows a badge for a codex row", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "c", title: "Cx", agent: "codex" })] });
    expect(wrapper.find('[data-testid="agent-badge"]').exists()).toBe(true);
    await wrapper.find('[data-testid="session-item"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["c", "codex"]);
  });

  // The row actions the phone needs (there is no hover on a touch screen, so they are always
  // shown there). Both must act on the row WITHOUT selecting it — @click.stop — or dismissing a
  // session would first open it.
  it("emits 'hide' with the session id when the ✕ is clicked, without selecting it", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a", title: "Alpha" })] });
    await wrapper.find('[data-testid="session-hide"]').trigger("click");
    expect(wrapper.emitted("hide")).toEqual([["a"]]);
    expect(wrapper.emitted("select")).toBeUndefined(); // @click.stop — hiding isn't selecting
  });

  it("emits 'delete' with the session id when the 🗑 is clicked, without selecting it", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a", title: "Alpha" })] });
    await wrapper.find('[data-testid="session-delete"]').trigger("click");
    expect(wrapper.emitted("delete")).toEqual([["a"]]);
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
