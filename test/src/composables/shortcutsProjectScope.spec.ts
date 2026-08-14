// The pinned-shortcuts file is ONE workspace-global file, shared with MulmoClaude. The collection
// index that triggers a reconcile fetches a list scoped to the SURFACE'S PROJECT. Those are two
// different universes, and reconciling one against the other is a mass deletion: every pin the
// workspace holds looks "gone" from a project's point of view, and `reconcile` prunes and
// PERSISTS.
//
// It happened. On 2026-08-09 opening the Collections pane on a project with one collection deleted
// twenty-one pinned collections from <workspace>/config/shortcuts.json — in both apps, with no undo
// and nothing on screen to say so. The feeds survived only because they are a different `kind`.
//
// So this spec is not about a nicety. It pins that a project-scoped answer reconciles NOTHING.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reconcile = vi.fn(async () => {});
vi.mock("../../../src/composables/useShortcuts", () => ({
  useShortcuts: () => ({ reconcile, unpin: vi.fn() }),
}));

// The binding is registered as a module side effect, not exported — so the way to test the REAL
// one is to catch what it registers.
interface Bound {
  reconcileShortcuts?: (kind: string, live: { slug: string; title: string; icon: string }[]) => Promise<void>;
  withScope?: (scope: string) => Bound;
  listCollections?: () => Promise<unknown>;
}
let bound: Bound = {};
vi.mock("@mulmoclaude/collection-plugin/vue", () => ({
  configureCollectionUi: (context: Bound) => {
    bound = context;
  },
  CollectionsIndexView: { name: "CollectionsIndexView", template: "<div />" },
  CollectionView: { name: "CollectionView", template: "<div />" },
  FeedsView: { name: "FeedsView", template: "<div />" },
}));

// Imported at module scope so its module graph is collection's cost, not the first test's
// (CLAUDE.md). The import itself is what registers the binding above.
await import("../../../src/composables/collectionUi");
const { pushCollectionSurface, popCollectionSurface } = await import("../../../src/composables/collectionSurface");
type CollectionSurface = import("../../../src/composables/collectionSurface").CollectionSurface;

const LIVE = [{ slug: "tasks", title: "Tasks", icon: "check" }];
const surfaces: CollectionSurface[] = [];

function showSurface(projectId: string | null) {
  const surface: CollectionSurface = { projectId, layer: "pane" };
  surfaces.push(surface);
  pushCollectionSurface(surface);
}

beforeEach(() => {
  reconcile.mockClear();
});

afterEach(() => {
  for (const surface of surfaces.splice(0)) popCollectionSurface(surface);
});

// A chat card is not the pane: it was made in one project and must keep reading it, while the
// ambient project moves with whatever surface is on screen. The plugin (>= 3.1.0) asks the host
// for a binding of its own; without one, a card built in project A shows project B's records the
// moment the user walks away from A — same slug, same title, different rows.
describe("withScope binds a card to the project it was made in", () => {
  const urlOf = async (ui: Bound, run: (ui: Bound) => unknown): Promise<string> => {
    let seen = "";
    globalThis.fetch = vi.fn((url: string) => {
      seen = String(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }) as unknown as typeof fetch;
    await run(ui);
    return seen;
  };

  it("is offered at all — the plugin only scopes a host that says it can", () => {
    expect(typeof bound.withScope).toBe("function");
  });

  it("carries the CARD's project, not the surface's", async () => {
    showSurface("pane-project");
    const scoped = bound.withScope?.("card-project");
    expect(scoped).toBeDefined();
    const url = await urlOf(scoped as Bound, (ui) => ui.listCollections?.());
    expect(url).toContain("project=card-project");
    expect(url).not.toContain("pane-project");
  });

  it("keeps carrying it after the surface moves — the bug, stated as a test", async () => {
    const scoped = bound.withScope?.("card-project") as Bound;
    showSurface("another-project");
    const url = await urlOf(scoped, (ui) => ui.listCollections?.());
    expect(url).toContain("project=card-project");
  });

  it("leaves the global binding following the surface", async () => {
    showSurface("pane-project");
    const url = await urlOf(bound, (ui) => ui.listCollections?.());
    expect(url).toContain("project=pane-project");
  });
});

describe("reconcileShortcuts is refused for a project-scoped list", () => {
  it("reconciles when the visible surface is the workspace", async () => {
    await bound.reconcileShortcuts?.("collection", LIVE);
    expect(reconcile).toHaveBeenCalledWith("collection", LIVE);
  });

  it("reconciles when a surface says it IS the workspace", async () => {
    showSurface(null);
    await bound.reconcileShortcuts?.("collection", LIVE);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  // The bug, exactly: a pane open on a project, an index fetch scoped to it, and the workspace's
  // pins judged against a list that was never about them.
  it("does NOTHING when the visible surface is a project", async () => {
    showSurface("p1");
    await bound.reconcileShortcuts?.("collection", LIVE);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("does nothing for feeds either — the scope is what matters, not the kind", async () => {
    showSurface("p1");
    await bound.reconcileShortcuts?.("feed", LIVE);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("resumes once the project surface is gone", async () => {
    showSurface("p1");
    await bound.reconcileShortcuts?.("collection", LIVE);
    expect(reconcile).not.toHaveBeenCalled();

    for (const surface of surfaces.splice(0)) popCollectionSurface(surface);
    await bound.reconcileShortcuts?.("collection", LIVE);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
