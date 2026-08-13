// A parked cell is one the user has set aside: still connected, still holding its history, but
// no longer something to look at. It replaces reaching for `/clear` to make a cell read as
// "not my concern", which changed the CONVERSATION to change the DISPLAY (#992).
//
// The sinking applies wherever the cell itself renders — the tiled grid and the filmstrip are the
// same component instance, teleported rather than remounted (docs/grid-view-modes.md), so one
// rule covers both. The cockpit roster draws its own rows and has its own branch for this in
// rosterAlertClasses.
import type { AttentionStatus } from "./attentionStatus";
import { CELL_DOT_IDLE, CELL_DOT_WORKING_STILL } from "./cellChromeClasses";

// One state breaks the parking: `blocked` — nothing proceeds until the user answers, and missing
// a permission prompt because the cell was set aside is the accident this feature must not cause.
// `done` is NOT in that company, since a parked agent finishing its turn is what parking it leads
// to, and un-sinking there would undo the setting on its own.
//
// Being ENLARGED does not break it. Selecting a parked session is how you look at one without
// waking it, and a cell that came back to full strength on selection would be un-parked by the
// very act of checking on it. What wakes it is putting something IN: the cell turns the flag off
// on the terminal's first input, so nobody has to reach back for the moon button to undo what
// they have already started doing.
export function isCellSunk(parked: boolean, status: AttentionStatus): boolean {
  return parked && status !== "blocked";
}

// Opacity ALONE. Every status branch in TerminalCell (CELL_STATUS / HEADER_STATUS / DOT_STATUS)
// names its own border, background and ink, and two utilities setting one property are resolved
// by Tailwind's output order rather than by intent — so the sunk look may only use a property
// none of them touch.
export const SUNK_CELL = "opacity-40";

// The dot while sunk. A second complete map rather than a conditional edit of DOT_STATUS, so
// every state still names its own value in one place: `working` loses `animate-cell-pulse`,
// because the cost a parked cell is meant to stop paying is MOTION in the corner of the eye.
// `blocked` cannot reach here (isCellSunk excludes it) but is named anyway — a partial map would
// make the caller handle an absence that the type system would then have to model.
export const SUNK_DOT_STATUS = {
  idle: CELL_DOT_IDLE,
  working: CELL_DOT_WORKING_STILL,
  done: "bg-accent",
  blocked: "bg-amber",
} as const satisfies Record<AttentionStatus, string>;
