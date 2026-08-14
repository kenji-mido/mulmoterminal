// Navigation seam for the cross-repo GitHub view — a thin derivation over vue-router, mirroring
// useWikiBrowse / useAccountingView. The open view is entirely the URL: /github = the list.
// The toolbar button and App's overlay read these.
//
// `/prs` still resolves here (the router redirects it): it was the path before the view was named
// for what it actually shows, and it may be bookmarked.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

// Whether the GitHub list is the open view. Doubles as "already inside this overlay", so a
// re-open keeps the origin it was first entered with instead of recording the overlay itself.
const isGithubRoute = (): boolean => router.currentRoute.value.name === "github";

/** Open the cross-repo GitHub list. */
export function githubGotoIndex(): void {
  void router.push({ path: "/github", state: overlayOriginState() });
}

/** Close the GitHub view → back to the view it was opened from. */
export function githubClose(): void {
  void router.push(overlayReturnPath());
}

export function useGithubView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(isGithubRoute),
    close: githubClose,
  };
}
