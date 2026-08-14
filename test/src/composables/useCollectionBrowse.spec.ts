import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createApp, defineComponent } from "vue";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import {
  useCollectionBrowse,
  browseGotoIndex,
  browseGotoDetail,
  browseNavigateToRecord,
  browseSetSelectedId,
  browseRouteSlug,
  browseRouteSelectedId,
  browseIsFeedRoute,
  browseRouteProjectId,
  browseClose,
} from "../../../src/composables/useCollectionBrowse";

// Install the singleton router into a throwaway app so currentRoute tracks pushes.
beforeAll(async () => {
  createApp(defineComponent({ render: () => null })).use(router);
  await router.isReady();
});

beforeEach(async () => {
  await router.replace("/terminals");
  await flushPromises();
  browseSetSelectedId(null);
});

describe("useCollectionBrowse over the router", () => {
  it("browseGotoIndex / browseGotoDetail push the right paths", async () => {
    browseGotoIndex("collection");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections");

    browseGotoIndex("feed");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/feeds");
    expect(browseIsFeedRoute()).toBe(true);

    browseGotoDetail("collection", "todos");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/todos");
    expect(browseRouteSlug()).toBe("todos");
  });

  it("view computed reflects currentRoute", async () => {
    const { view, isOpen } = useCollectionBrowse();
    expect(view.value).toEqual({ mode: "closed" });
    expect(isOpen.value).toBe(false);

    browseGotoIndex("feed");
    await flushPromises();
    expect(view.value).toEqual({ mode: "index", kind: "feed" });
    expect(isOpen.value).toBe(true);

    browseGotoDetail("collection", "todos");
    await flushPromises();
    expect(view.value).toEqual({ mode: "detail", kind: "collection", slug: "todos", selectedId: null });
  });

  it("selectedId is modal-only state and never enters the URL", async () => {
    browseGotoDetail("collection", "todos");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", selectedId: "rec-1" });
    // The record is NOT in the URL — opening it added no history / query.
    expect(router.currentRoute.value.fullPath).toBe("/collections/todos");
  });

  it("a slug change drops the open record (records are not history)", async () => {
    browseGotoDetail("collection", "todos");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Navigating to another collection page leaves the rec-1 modal behind.
    browseGotoDetail("collection", "other");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "other", selectedId: null });

    browseClose();
    await flushPromises();
    expect(useCollectionBrowse().view.value).toEqual({ mode: "closed" });
    expect(browseRouteSelectedId()).toBeUndefined();
  });

  it("navigateToRecord lands on the detail page with the record deep-linked", async () => {
    browseNavigateToRecord("bar", "rec-2");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/bar");
    expect(browseRouteSelectedId()).toBe("rec-2");
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", kind: "collection", slug: "bar", selectedId: "rec-2" });
  });

  it("navigateToRecord without a recordId on the current page closes any open record", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Re-target the SAME page with no record id — the path doesn't change (so the
    // watcher never fires), but the stale modal must still close, not be reused.
    browseNavigateToRecord("foo");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/foo");
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", slug: "foo", selectedId: null });
  });

  it("does not leak a record across kinds when slugs overlap (collection foo → feed foo)", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Same slug, different kind → the collection's record must NOT bleed into the feed page.
    browseGotoDetail("feed", "foo");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/feeds/foo");
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ mode: "detail", kind: "feed", slug: "foo", selectedId: null });
  });

  it("a bare route push (toolbar Chat/Grid) drops the record, so returning can't revive it", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // The toolbar's Grid button pushes a bare route WITHOUT calling any browse setter — the
    // sync path watcher must still drop the record on the way out.
    router.push("/terminals");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();

    // Returning to the detail URL by any means (browser Back, a retyped URL) lands
    // here — the record was dropped on leave, so the modal must NOT revive.
    router.push("/collections/foo");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "foo", selectedId: null });
  });

  it("returning to a page via normal navigation does not revive a stale record modal", async () => {
    browseGotoDetail("collection", "foo");
    await flushPromises();
    browseSetSelectedId("rec-1");
    expect(browseRouteSelectedId()).toBe("rec-1");

    // Leave, then come back to the SAME page by a normal (non-record) navigation.
    browseGotoDetail("collection", "bar");
    await flushPromises();
    browseGotoDetail("collection", "foo");
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
    expect(useCollectionBrowse().view.value).toMatchObject({ slug: "foo", selectedId: null });
  });
});

// The project lives in the URL because it decides WHICH collections the page is listing —
// unlike the open record, which is a modal and deliberately not addressable. A completion bell
// from a project is the only thing that puts one there today.
describe("the project a browse page is scoped to", () => {
  it("is null on every ordinary open", async () => {
    browseGotoIndex("collection");
    await flushPromises();
    expect(browseRouteProjectId()).toBeNull();
  });

  it("rides in the query when a bell names one, and comes back out", async () => {
    browseNavigateToRecord("tasks", "t1", "p1");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/tasks");
    expect(router.currentRoute.value.query.project).toBe("p1");
    expect(browseRouteProjectId()).toBe("p1");
    expect(browseRouteSelectedId()).toBe("t1");
  });

  it("is CARRIED by a nav made inside a project — a ref hop must not fall back to the workspace", async () => {
    browseNavigateToRecord("tasks", "t1", "p1");
    await flushPromises();
    browseNavigateToRecord("people");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/collections/people");
    expect(browseRouteProjectId()).toBe("p1");

    browseGotoDetail("collection", "notes");
    await flushPromises();
    expect(browseRouteProjectId()).toBe("p1");

    browseGotoIndex("collection");
    await flushPromises();
    expect(browseRouteProjectId()).toBe("p1");
  });

  // The record modal is keyed by the PAGE, and two projects' /collections/tasks are one path.
  // Browser Back and a hand-typed URL are the navigations this module does not route itself, so
  // they are the ones that reach a project change with the path unmoved — and with a primaryKey
  // schema the surviving id often EXISTS in the project landed on, so the modal shows a
  // different record of the same name instead of failing visibly.
  it("drops the open record when only the project changes (Back / a hand-typed URL)", async () => {
    browseNavigateToRecord("tasks", "t1", "p1");
    await flushPromises();
    expect(browseRouteSelectedId()).toBe("t1");

    // Same path, project gone — what Back onto the workspace page looks like to the router.
    await router.push({ path: "/collections/tasks" });
    await flushPromises();
    expect(browseRouteProjectId()).toBeNull();
    expect(browseRouteSelectedId()).toBeUndefined();
  });

  it("drops it in the other direction too — workspace record, then a project URL", async () => {
    browseNavigateToRecord("tasks", "t1");
    await flushPromises();
    expect(browseRouteSelectedId()).toBe("t1");

    await router.push({ path: "/collections/tasks", query: { project: "p1" } });
    await flushPromises();
    expect(browseRouteSelectedId()).toBeUndefined();
  });

  it("does not revive a record when the same project page is returned to", async () => {
    browseNavigateToRecord("tasks", "t1", "p1");
    await flushPromises();
    await router.push({ path: "/collections/people", query: { project: "p1" } });
    await flushPromises();
    await router.push({ path: "/collections/tasks", query: { project: "p1" } });
    await flushPromises();
    // Records are not history: coming back to the exact same page must not restore the modal.
    expect(browseRouteSelectedId()).toBeUndefined();
  });

  it("is DROPPED when a workspace bell names null explicitly, rather than inheriting the open one", async () => {
    browseNavigateToRecord("tasks", "t1", "p1");
    await flushPromises();
    browseNavigateToRecord("tasks", "t2", null);
    await flushPromises();
    expect(browseRouteProjectId()).toBeNull();
    expect(browseRouteSelectedId()).toBe("t2");
  });
});
