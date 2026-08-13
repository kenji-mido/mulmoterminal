// Navigation seam for the cross-repo PR list view — a thin derivation over vue-router,
// mirroring useWikiBrowse / useAccountingView. The open view is entirely the URL:
// /prs = the PR list. The toolbar button and App's overlay read these.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

// Whether the PR list is the open view. Doubles as "already inside this overlay", so a
// re-open keeps the origin it was first entered with instead of recording the overlay itself.
const isPrsRoute = (): boolean => router.currentRoute.value.name === "prs";

/** Open the cross-repo PR list. */
export function prsGotoIndex(): void {
  void router.push({ path: "/prs", state: overlayOriginState() });
}

/** Close the PR view → back to the view it was opened from. */
export function prsClose(): void {
  void router.push(overlayReturnPath());
}

export function usePrsView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(isPrsRoute),
    close: prsClose,
  };
}
