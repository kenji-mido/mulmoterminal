// Which surface the collection plugin is currently showing — and therefore which project its
// requests are scoped to and where its navigation goes.
//
// SCOPE AND NAVIGATION ARE ONE THING, which is the correction this file exists to make. They were
// two: a nav stack here and a global `activeProjectId` in collectionProject.ts. A mounted pane
// then owned the project for EVERY consumer, so opening the full-screen overlay over it fetched
// and mutated the pane's project while sending its own clicks into the hidden pane. Both halves
// of that bug are "the surface being looked at is not the surface being asked", so both are
// answered by one stack of surfaces rather than two pieces of ambient state.
//
// The plugin's views (CollectionsIndexView, CollectionView, the record modal) navigate through
// ONE global binding — `collectionUi.ts` — because the package has no router of its own and the
// host supplies the nav capabilities. That was unambiguous while the full-screen overlay was the
// only surface: `gotoDetail` meant "open it in the overlay", which is the app's URL.
//
// A collections PANE beside a cell breaks that assumption. Opening a collection there must not
// move the whole app to the overlay's route, and two cells looking at different projects must
// not share one "open collection". So the surface that is currently showing collections
// registers itself here, and the binding dispatches to it instead of the router.
//
// A STACK, mirroring `pushCollectionTeleportTarget` above it in collectionUi.ts, and for the same
// reason: surfaces nest (the overlay can open over a pane) and the innermost one is the one the
// user is looking at, so last-registered wins and unregistering restores the previous.
import type { ShortcutKind } from "../../common/shortcuts";

/** How a surface navigates. The shape is the nav half of the plugin binding, unchanged — a
 *  surface IS the thing those capabilities meant. */
export interface CollectionNavSurface {
  routeSlug: () => string | undefined;
  routeSelectedId: () => string | undefined;
  isFeedRoute: () => boolean;
  setSelectedId: (itemId: string | null) => void;
  gotoIndex: (kind: ShortcutKind) => void;
  gotoDetail: (kind: ShortcutKind, slug: string) => void;
  navigateToRecord: (targetSlug: string, recordId?: string) => void;
}

/** A surface: where navigation goes, and which project its requests name. `projectId: null` is
 *  the shared workspace — what the full-screen overlay shows, and what everything showed before
 *  panes existed. */
/** How a surface sits on the screen. `"screen"` covers everything below it (the full-screen
 *  collection browser); `"pane"` is the right-hand slot beside the terminal (the Collections pane
 *  and the canvas, which share it).
 *
 *  Precedence is by LAYER first, push order second — not push order alone. A canvas can mount
 *  while the full-screen browser is already open (a tool result auto-reveals one behind it), and
 *  the surface that mounted last is then not the surface being looked at. */
export type CollectionSurfaceLayer = "pane" | "screen";

export interface CollectionSurface {
  projectId: string | null;
  /** Defaults to `"pane"` — the slot beside the terminal. */
  layer?: CollectionSurfaceLayer;
  /** How this surface navigates — OPTIONAL, because scoping and navigating are not always the
   *  same claim. The canvas shows one session's cards and must scope their fetches to that
   *  session's project, but a link inside a card still belongs to the full-screen browser: a
   *  canvas that took navigation would swallow it. */
  nav?: CollectionNavSurface;
}

// A PLAIN array, deliberately not a `ref`. Nothing renders from this stack — it is read
// imperatively, at the moment a request is built or a navigation dispatched — and a `ref` wraps
// the surfaces in reactive proxies, which breaks the identity a pop depends on: the caller holds
// the raw object it pushed, the array holds a proxy of it, and the surface is never removed.
const stack: CollectionSurface[] = [];

export function pushCollectionSurface(surface: CollectionSurface): void {
  stack.push(surface);
}

export function popCollectionSurface(surface: CollectionSurface): void {
  const i = stack.lastIndexOf(surface);
  if (i >= 0) stack.splice(i, 1);
}

/** The surfaces that can be the visible one: those on the topmost occupied LAYER. A full-screen
 *  surface covers every pane, so once one is registered nothing in a pane can be what the user is
 *  looking at, however recently it mounted. */
function visibleSurfaces(): CollectionSurface[] {
  const screen = stack.filter((surface) => surface.layer === "screen");
  return screen.length > 0 ? screen : stack;
}

/** The project the visible surface is scoped to — null for the workspace, which is also the
 *  answer when no surface is registered at all. */
export function activeCollectionProjectId(): string | null {
  return visibleSurfaces().at(-1)?.projectId ?? null;
}

/** The surface currently driving navigation, or null when only the router-backed overlay is up.
 *  Null is the DEFAULT, not a failure: with no pane mounted the binding keeps behaving exactly as
 *  it did, which is what keeps this change invisible to the overlay. */
export function activeCollectionNavSurface(): CollectionNavSurface | null {
  // The topmost VISIBLE surface that has a nav, not the topmost surface: a scope-only surface
  // above it (the canvas) must not silence the one below that can actually navigate, and a pane
  // must not answer for a full-screen browser covering it.
  const visible = visibleSurfaces();
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    const nav = visible[i]?.nav;
    if (nav) return nav;
  }
  return null;
}
