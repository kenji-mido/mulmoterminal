// The cell header's hover tips (#1235): one shared tip, opened by whichever chip the pointer is on.
//
// A SINGLETON with handlers bound to the existing chip, rather than a wrapper component around each
// one. Two reasons, both about the header: it is a flex row whose children carry `flex-none` and
// `min-w-0` deliberately, so an extra element between them changes the layout the chips were tuned
// in; and one tip in the document cannot become two, which a per-chip component can when a pointer
// leaves one chip straight onto the next.
//
// Moving between chips needs no special handling: the DOM fires the old element's `pointerleave`
// BEFORE the new one's `pointerenter`, so the close-then-open lands in one tick and Vue renders it
// as a change of content rather than as a blink.
//
// No delay. That is the request, and it is also why `title` could not be kept: its delay belongs to
// the browser and is not settable from CSS or script.
import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { TipContent } from "../components/tipContent";
import type { TipRect } from "./hoverTipPlacement";

/** The one tip element's id, so an anchor can point at it with `aria-describedby` while its own tip
 *  is up. One id is enough precisely because there is only ever one tip. */
export const HOVER_TIP_ID = "hover-tip";

export interface OpenTip {
  content: TipContent;
  anchor: TipRect;
  /** Which anchor this tip belongs to, so an anchor can tell whether it is the one being
   *  described. See `useHoverTipAnchor` — it is why that is derived rather than remembered. */
  owner: number;
}

const tip = ref<OpenTip | null>(null);

const rectOf = (el: Element): TipRect => {
  const { top, bottom, left, right } = el.getBoundingClientRect();
  return { top, bottom, left, right };
};

/** Show `content` describing the element the handler is bound to; answers whether it opened.
 *
 *  Empty content CLOSES rather than opening an empty box: every builder in tipContent.ts answers
 *  `[]` for a state it cannot describe (a directory that is not a repo, a work item still being
 *  fetched), so this is the ordinary case for a chip whose data has not arrived yet. */
export function showHoverTip(event: Event, content: TipContent, owner = 0): boolean {
  const el = event.currentTarget;
  const open = el instanceof Element && content.length > 0;
  tip.value = open && el instanceof Element ? { content, anchor: rectOf(el), owner } : null;
  return open;
}

export function hideHoverTip(): void {
  tip.value = null;
}

// Ids start at 1, so the `owner = 0` default above means "opened by no anchor" and can never be
// mistaken for one. Handing out 0 would make whichever chip holds it claim every such tip.
let nextAnchorId = 0;

/** Bind a chip to the shared tip. `content` is read at hover time rather than watched, because a
 *  header polls (git status, work item, context) and the value wanted is the one on screen now.
 *
 *  `described` is DERIVED from the shared state, not remembered locally. A local mirror goes stale
 *  the moment anything closes the tip without telling this anchor — a scroll, a resize, a
 *  pointerdown, all of which HoverTip.vue listens for — and the chip is then left pointing
 *  `aria-describedby` at an element that no longer exists (Codex, this PR). Derived, one anchor at
 *  a time is true by construction and closing needs to tell nobody. */
export function useHoverTipAnchor(content: () => TipContent): { described: ComputedRef<boolean>; show: (event: Event) => void; hide: () => void } {
  const id = ++nextAnchorId;
  const described = computed(() => tip.value?.owner === id);
  const show = (event: Event): void => {
    showHoverTip(event, content(), id);
  };
  return { described, show, hide: hideHoverTip };
}

export function useHoverTipState(): { tip: Ref<OpenTip | null> } {
  return { tip };
}
