// The fork's rule for a grid shared across devices: the screen being LOOKED AT is the one that
// holds its sessions. Lifted out of useTerminalConnections.ts, which the 4.4.0 merge pushed past
// the 600-line limit — this is the piece that file carries and upstream's does not, so it is the
// piece that moves.
//
// The connect side of the rule (a slot that defers instead of connecting while the document is
// hidden) stays in connect(), where the decision is made. This is the other half: what happens
// the moment the document is looked at again.
import type { ConnStatus } from "./useTerminalConnections";

// Just enough of a Conn for this rule. Kept structural rather than importing the real type: the
// rule reads two fields and asks nothing else of a slot.
export interface HandoffSlot {
  attachedEl: HTMLElement | null;
  deferredConnect: boolean;
}

/**
 * Both halves of "being looked at is what holds a session": what waited while hidden connects
 * now, and what another window took while we were away comes back — instead of leaving a
 * screenful of terminals that each need a tap on "Reconnect here".
 *
 * Call from a whenDocumentVisible handler, i.e. only on the TRANSITION to visible, so two screens
 * that are both open do not fight: whichever the user turned to last holds the sessions, and
 * nothing re-triggers until someone looks somewhere else.
 */
export function reclaimVisibleSlots<S extends HandoffSlot>(
  slots: Iterable<[string, S]>,
  statusOf: (key: string) => ConnStatus | undefined,
  connect: (slot: S) => void,
  reconnect: (key: string) => void,
): void {
  for (const [key, slot] of slots) {
    // Only a slot that is actually ON SCREEN. A slot outlives the view that mounted it (that is
    // what makes a page switch cheap), so the map holds ones nothing is rendering — and a
    // detached slot taking "its" session back would take it from the cell the user is looking
    // at, on this very device. Being looked at is the rule; an element is how a slot is.
    if (!slot.attachedEl) continue;
    if (slot.deferredConnect) {
      slot.deferredConnect = false;
      connect(slot);
    } else if (statusOf(key) === "superseded") {
      reconnect(key); // taken by another window while we were away — take it back
    }
  }
}
