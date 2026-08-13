import type { AttentionStatus } from "./attentionStatus";

// The cockpit roster row's "whose turn is it" chrome (#1131).
//
// The row used to say its status in an 8px dot and a 10px badge, both sitting on a bar painted
// with the DIRECTORY's configured colour — so an amber-ish directory swallowed the amber of
// `waiting`, the same collision the launcher chips had in #1106. The row's own channels (left
// edge, wash) were spent on something else entirely: which row is expanded.
//
// So the status moves out to the row scale, in two strengths:
//   blocked -> nothing proceeds until you answer  -> amber, and it MOVES
//   done    -> the turn ended, it wants reading   -> green, and it holds still
//
// Motion is deliberately spent on `blocked` alone. The roster already animates a spinner on a
// working row, so a second moving thing is a real cost — paid only for the state where the user
// is what the work waits on, and switchable off (see useRosterAlert).
//
// Every branch names the frame colour, the left edge, the background AND the hover background. A
// branch that set only what it changes would leave the other properties to the base class, and
// which of two competing utilities wins is decided by Tailwind's output order rather than by the
// order they are written (the same rule the cell dot and the launcher chip are built around).
//
// A blinking row is the one place where the hover wash does not land: the keyframes animate
// `background-color`, and an animation outranks a plain declaration. Forcing it would freeze the
// wash under the pointer while the ring kept pulsing, and the blink is already the feedback.
const ROW_BLINK = "animate-roster-alert motion-reduce:animate-none";
// The amber the blink is layered ON TOP of, not an alternative to it: `prefers-reduced-motion` and
// the setting both stop the keyframes, and without a static value underneath, such a row would keep
// whatever the animation's first frame happened to paint.
//
// The RING is the load-bearing part, and it was added after looking at the real screen: the row's
// top bar is painted with the directory's colour and covers its upper half, so a wash alone
// appeared only in the strip below the bar — and on an amber-tinted directory the bar itself read
// as the alert. The ring sits outside the row's box, where no directory colour can reach it. Same
// idiom the grid cell already uses for these two states (TerminalCell's CELL_STATUS).
// Hover mixes MORE of the same colour instead of brightening the row (#1168). One
// `brightness(1.15)` on the row is right on a dark panel and wrong on a light one: `--bg-panel` is
// pure white in Daylight, so an 8% wash sits within a few percent of white, every channel clips,
// and the hovered row goes white — the state colour disappears exactly while you point at it.
// A stronger mix of the SAME colour keeps the hue in all four themes.
const ROW_BLOCKED =
  "border-border border-l-[#f59e0b] bg-[color-mix(in_srgb,#f59e0b_14%,var(--bg-panel))] hover:bg-[color-mix(in_srgb,#f59e0b_24%,var(--bg-panel))] shadow-[0_0_0_2px_color-mix(in_srgb,#f59e0b_60%,transparent)]";
const ROW_DONE =
  "border-border border-l-[#22c55e] bg-[color-mix(in_srgb,#22c55e_8%,var(--bg-panel))] hover:bg-[color-mix(in_srgb,#22c55e_18%,var(--bg-panel))] shadow-[0_0_0_1px_color-mix(in_srgb,#22c55e_45%,transparent)]";
// The row you are looking at, and a row with nothing to say — neither carries a status colour, so
// their hover is the theme's own.
const ROW_EXPANDED = "border-[#4a9eff] border-l-[#4a9eff] bg-panel hover:bg-hover";
const ROW_PLAIN = "border-border border-l-transparent bg-panel hover:bg-hover";
// A row the user has set aside (#992). It names the same frame, edge and background as a plain
// row and sinks with `opacity` — the one property no branch above sets, so the two never race.
const ROW_PARKED = `${ROW_PLAIN} opacity-45`;
// Parked AND the row being looked at. The blue edge is NAVIGATION — "you are here" — so it stays;
// the sink is the STATE, so it stays too. Dropping either would answer a different question than
// the one that was asked: selecting a parked session must not make it read as awake.
const ROW_PARKED_EXPANDED = `${ROW_EXPANDED} opacity-45`;

interface RosterAlertContext {
  // The row whose terminal is enlarged beside the list. It never alerts: a session you are
  // watching shows its own prompt, and its left edge already means "you are here" — one line
  // carrying two meanings is what made the status hard to read in the first place.
  expanded: boolean;
  // The user's setting (default on). Off leaves both states their still colours, which is the
  // point of the switch: the row stays findable, it just stops moving.
  blink: boolean;
  // Set aside by the user (#992). It sinks the row, but it is NOT allowed to hide a session that
  // has stopped and is waiting to be answered — hence the order below.
  parked: boolean;
}

// `blocked` outranks `parked` deliberately: nothing proceeds on that session until the user
// answers, and a row that cannot be seen because it was set aside is the accident this feature
// must not cause. `done` does NOT outrank it — a parked agent finishing its turn is the expected
// outcome of parking it, and floating that back up would undo the setting on its own.
// A parked, blocked, EXPANDED row is sunk here while the cell it points at is at full strength
// (isCellSunk lets `blocked` through). That asymmetry is deliberate and safe: the session is on
// screen, enlarged, so nothing is hidden — and this row's job in that moment is only to say which
// one you are on. The safety rule is about the SESSION being visible, not about its list entry.
export function rosterAlertClass(status: AttentionStatus, { expanded, blink, parked }: RosterAlertContext): string {
  if (expanded) return parked ? ROW_PARKED_EXPANDED : ROW_EXPANDED;
  if (status === "blocked") return blink ? `${ROW_BLOCKED} ${ROW_BLINK}` : ROW_BLOCKED;
  if (parked) return ROW_PARKED;
  if (status === "done") return ROW_DONE;
  return ROW_PLAIN;
}
