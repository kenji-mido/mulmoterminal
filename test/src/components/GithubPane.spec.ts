import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import GithubPane from "../../../src/components/GithubPane.vue";

// The pane is no longer route-driven — it fetches on mount — so there is nothing to stub for it
// to be "open". What remains stubbed is only what a router would otherwise be needed for.
vi.mock("../../../src/composables/useGithubView", () => ({
  useGithubView: () => ({ isOpen: ref(true), close: vi.fn() }),
}));

type Repo = { repo: string; prs?: unknown[]; error?: string; truncated?: boolean };
type IssueRepo = { repo: string; issues?: unknown[]; error?: string; truncated?: boolean; url?: string };

// The overlay fetches /api/prs and /api/issues in parallel; route the mock by path.
// opts.failPrs / opts.failIssues make that endpoint return a non-ok response.
function mockFetch(prs: Repo[], issues: IssueRepo[] = [], opts: { failPrs?: boolean; failIssues?: boolean; repoDirs?: unknown[] } = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    // The pane reads the reverse map to know which repo a cell's directory belongs to. It is the
    // same request the issue rows' start control already made, so it is answered here rather than
    // stubbed away — a pane that could not read it would silently stop leading with the repo.
    if (path.includes("/api/repo-dirs")) return { ok: true, json: async () => ({ repos: opts.repoDirs ?? [] }) };
    const isIssues = path.includes("/api/issues");
    if ((isIssues && opts.failIssues) || (!isIssues && opts.failPrs)) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ repos: isIssues ? issues : prs }) };
  }) as unknown as typeof fetch;
}

function pr(number: number, title: string) {
  return { number, title, author: "alice", updatedAt: new Date().toISOString(), isDraft: false, url: `u${number}`, review: null, ci: "none" };
}

describe("GithubPane", () => {
  it("groups repos and lists their open PRs", async () => {
    mockFetch([
      {
        repo: "octo/hello",
        prs: [
          {
            number: 3,
            title: "fix the bug",
            author: "alice",
            updatedAt: new Date().toISOString(),
            isDraft: false,
            url: "u3",
            review: "APPROVED",
            ci: "passing",
          },
        ],
        truncated: true,
      },
      { repo: "octo/empty", prs: [] },
    ]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("octo/hello");
    expect(w.text()).toContain("#3");
    expect(w.text()).toContain("fix the bug");
    expect(w.text()).toContain("approved");
    expect(w.text()).toContain("more open PRs"); // truncation note
    expect(w.text()).toContain("No open PRs"); // octo/empty
    // Rows are real links (right-click / new-tab / ⌘-click work), not JS buttons.
    const row = w.get('[data-testid="prs-row"]');
    expect(row.attributes("href")).toBe("u3");
    expect(row.attributes("target")).toBe("_blank");
    expect(row.attributes("rel")).toContain("noopener");
  });

  it("lists open issues below the PRs and links to GitHub when truncated", async () => {
    mockFetch(
      [{ repo: "octo/hello", prs: [] }],
      [
        {
          repo: "octo/hello",
          issues: [{ number: 42, title: "flaky test", author: "bob", updatedAt: new Date().toISOString(), url: "https://github.com/octo/hello/issues/42" }],
          truncated: true,
          url: "https://github.com/octo/hello/issues",
        },
        { repo: "octo/quiet", issues: [] },
      ],
    );
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("Issues");
    expect(w.text()).toContain("#42");
    expect(w.text()).toContain("flaky test");
    expect(w.text()).toContain("No open issues"); // octo/quiet
    expect(w.get('[data-testid="prs-row"]').attributes("href")).toBe("https://github.com/octo/hello/issues/42"); // issue row is a real link
    const seeAll = w.get('[data-testid="prs-link"]');
    expect(seeAll.attributes("href")).toBe("https://github.com/octo/hello/issues");
    expect(seeAll.text()).toContain("see all open issues");
  });

  it("keeps rendering one section when the other endpoint fails", async () => {
    // /api/issues fails → PRs must still render, issue section shows its own error.
    mockFetch([{ repo: "octo/hello", prs: [pr(3, "still visible")] }], [], { failIssues: true });
    const w1 = mount(GithubPane);
    await flushPromises();
    expect(w1.text()).toContain("still visible"); // PR dashboard not blanked
    expect(w1.text()).toContain("HTTP 500"); // issue section error

    // Reverse: /api/prs fails → issues still render.
    mockFetch([], [{ repo: "octo/hello", issues: [{ number: 9, title: "issue shows", author: "bob", updatedAt: new Date().toISOString(), url: "u9" }] }], {
      failPrs: true,
    });
    const w2 = mount(GithubPane);
    await flushPromises();
    expect(w2.text()).toContain("issue shows");
    expect(w2.text()).toContain("HTTP 500");
  });

  it("shows a per-repo error", async () => {
    mockFetch([{ repo: "octo/x", error: "no access" }]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("no access");
  });

  it("hints to configure repos when none are set", async () => {
    mockFetch([]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("No repositories configured");
  });

  // The whole point of the pane form: opened beside a cell, the list leads with that cell's repo
  // rather than making the user find it. Reordering rather than scrolling — an empty section at
  // the top still answers "yours: none", where a scroll would have nothing to land on.
  it("leads with the repo of the cell it was opened beside", async () => {
    mockFetch(
      [
        { repo: "octo/first", prs: [pr(1, "one")] },
        { repo: "octo/mine", prs: [pr(2, "two")] },
      ],
      [],
      {
        repoDirs: [{ repo: "octo/mine", dirs: [{ path: "/srv/mine", label: "mine", orderPriority: null }], primary: null }],
      },
    );
    const w = mount(GithubPane, { props: { cwd: "/srv/mine" } });
    await flushPromises();
    const lead = w.find('[data-testid="github-lead"]');
    expect(lead.exists()).toBe(true);
    // The repo is named ONCE, above both halves — the pair is the point, not two sections the
    // user scrolls between.
    expect(lead.text()).toContain("octo/mine");
    expect(lead.text()).toContain("two");
    // …and it is pulled OUT of the list below, rather than repeated there.
    expect(lead.text()).not.toContain("octo/first");
    expect(w.text().indexOf("octo/mine")).toBeLessThan(w.text().indexOf("octo/first"));
  });

  it("pairs the lead repo's PRs and issues under one heading", async () => {
    mockFetch(
      [{ repo: "octo/mine", prs: [pr(2, "a pr")] }],
      [{ repo: "octo/mine", issues: [{ number: 9, title: "an issue", author: "bob", updatedAt: new Date().toISOString(), url: "u9" }] }],
      {
        repoDirs: [{ repo: "octo/mine", dirs: [{ path: "/srv/mine", label: "mine", orderPriority: null }], primary: null }],
      },
    );
    const w = mount(GithubPane, { props: { cwd: "/srv/mine" } });
    await flushPromises();
    const lead = w.find('[data-testid="github-lead"]');
    expect(lead.text()).toContain("a pr");
    expect(lead.text()).toContain("an issue");
  });

  // The decision behind this: a plain shell cell, or a clone the user never registered in
  // Settings, still opens a useful list. It must not error and must not blank.
  it("keeps the configured order for a cell whose directory names no repo", async () => {
    mockFetch(
      [
        { repo: "octo/first", prs: [pr(1, "one")] },
        { repo: "octo/second", prs: [pr(2, "two")] },
      ],
      [],
      {
        repoDirs: [{ repo: "octo/second", dirs: [{ path: "/srv/elsewhere", label: "e", orderPriority: null }], primary: null }],
      },
    );
    const w = mount(GithubPane, { props: { cwd: "/srv/unregistered" } });
    await flushPromises();
    // No lead block at all, and nothing lost: both repos still render, in the configured order.
    expect(w.find('[data-testid="github-lead"]').exists()).toBe(false);
    const headings = w.findAll("h3").map((h) => h.text());
    expect(headings[0]).toContain("octo/first");
    expect(w.text()).toContain("octo/second");
  });

  it("renders without a cwd at all — the toolbar's full-screen host", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.text()).toContain("octo/first");
  });

  // A layout guard, weak on purpose: jsdom does no layout, so this cannot catch a squeezed
  // terminal. What it CAN do is stop the two constraints being dropped again. They were missing on
  // the first cut and the pane — a flex item whose default `min-width: auto` refuses to go
  // narrower than a long PR title — grew past the width the grid gave it and pushed the terminal
  // out of view entirely. Neither was needed while this was a full-screen `fixed` overlay.
  it("keeps the flex constraints that let the grid size it", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane);
    await flushPromises();
    const root = w.find('[role="region"]');
    expect(root.classes()).toContain("min-w-0");
    expect(root.classes()).toContain("h-full");
  });

  // paneFull covers every pane except files, so this one CAN be widened over the terminal. The
  // control to undo that has to travel with it: without the button, a cell that remembered this
  // pane could open full-width with no route back to the split (Codex review) — the same class of
  // trap as the missing min-w-0, reached a different way.
  it("offers a way back from full width, and says which state it is in", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane, { props: { expanded: true, canExpand: true } });
    await flushPromises();
    const btn = w.find('[data-testid="github-expand-btn"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("aria-label")).toContain("Restore");
    await btn.trigger("click");
    expect(w.emitted("toggleExpand")).toBeTruthy();
  });

  it("offers the expand control when it is beside the terminal", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane, { props: { canExpand: true } });
    await flushPromises();
    expect(w.find('[data-testid="github-expand-btn"]').attributes("aria-label")).toContain("Expand");
  });

  // The overlay IS the whole screen, so there is nothing to expand over — and it listens for no
  // toggleExpand, which made the button a visible no-op there (Codex review). Absence is the fix,
  // not a disabled state: a control that cannot do anything should not be offered.
  it("hides the expand control in a host that has nothing to expand over", async () => {
    mockFetch([{ repo: "octo/first", prs: [pr(1, "one")] }]);
    const w = mount(GithubPane);
    await flushPromises();
    expect(w.find('[data-testid="github-expand-btn"]').exists()).toBe(false);
    // The close button is NOT conditional — every host needs it.
    expect(w.find('[aria-label="Close GitHub pane"]').exists()).toBe(true);
  });
});
