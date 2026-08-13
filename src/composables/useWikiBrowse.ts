// Navigation seam for the read-only wiki browser — a thin derivation over vue-router,
// mirroring useCollectionBrowse / useAccountingView. The open VIEW is entirely the URL
// (no retained state): /wiki = index, /wiki/pages/:slug = a page, /wiki/graph = graph,
// /wiki/lint = lint. The exported nav helpers are what the toolbar, the overlay tabs,
// and in-page [[link]] / backlink / graph-node clicks call.
//
// Read-only: there is no record/modal state to retain (that was Collections'
// complication), so this is purely view-state + push helpers.
import { computed, type ComputedRef } from "vue";
import { isSafeWikiSlug } from "@mulmoclaude/core/wiki";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

export type WikiView = { mode: "closed" } | { mode: "index" } | { mode: "page"; slug: string } | { mode: "graph" } | { mode: "lint" };

/** Open the wiki index (the page catalog). */
export function wikiGotoIndex(): void {
  void router.push({ path: "/wiki", state: overlayOriginState() });
}

/** Open the wiki index pre-filtered to a tag (e.g. the Worklog shortcut → `#worklog`).
 *  WikiIndexView reads `?tag=` into its initial selection. */
export function wikiGotoTag(tag: string): void {
  void router.push({ path: "/wiki", query: { tag }, state: overlayOriginState() });
}

/** Open one page by slug. Unsafe slugs are coerced to the index rather than pushing a
 *  route the API would reject — the guard mirrors the server's isSafeWikiSlug. */
export function wikiGotoPage(slug: string): void {
  const state = overlayOriginState();
  if (!isSafeWikiSlug(slug)) {
    void router.push({ path: "/wiki", state });
    return;
  }
  void router.push({ path: `/wiki/pages/${encodeURIComponent(slug)}`, state });
}

/** Open the link graph. */
export function wikiGotoGraph(): void {
  void router.push({ path: "/wiki/graph", state: overlayOriginState() });
}

/** Open the lint report. */
export function wikiGotoLint(): void {
  void router.push({ path: "/wiki/lint", state: overlayOriginState() });
}

/** Close the wiki overlay → back to the view it was opened from. */
export function wikiClose(): void {
  void router.push(overlayReturnPath());
}

/** Current page slug when on a page route, else undefined. */
export function wikiRouteSlug(): string | undefined {
  const slug = router.currentRoute.value.params.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

/** Derive the view from the current route. */
function currentView(): WikiView {
  switch (router.currentRoute.value.name) {
    case "wiki":
      return { mode: "index" };
    case "wikiPage": {
      const slug = wikiRouteSlug();
      return slug ? { mode: "page", slug } : { mode: "index" };
    }
    case "wikiGraph":
      return { mode: "graph" };
    case "wikiLint":
      return { mode: "lint" };
    default:
      return { mode: "closed" };
  }
}

export function useWikiBrowse(): {
  view: ComputedRef<WikiView>;
  isOpen: ComputedRef<boolean>;
  close: () => void;
} {
  return {
    view: computed(currentView),
    isOpen: computed(() => currentView().mode !== "closed"),
    close: wikiClose,
  };
}
