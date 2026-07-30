// "Is this document being looked at" — the question the connection layer asks twice.
//
// A hidden document must not TAKE a session: the server binds one to a single socket, so a
// client that opens one supersedes whoever held it, and a phone in a pocket would do that to the
// screen someone is working on. And the moment a document IS looked at again, it should take
// back what it deferred, and what another window took while it was away.
//
// Both halves are the same property of the DOCUMENT, not of any one slot, so they live together
// and behind a guard: there is no `document` under the node test environment.
export function documentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** Runs `handler` on the TRANSITION to visible — not on the one to hidden. */
export function whenDocumentVisible(handler: () => void): void {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) handler();
  });
}
