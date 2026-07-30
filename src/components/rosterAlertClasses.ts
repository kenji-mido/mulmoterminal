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
// Every branch names the frame colour, the left edge AND the background. A branch that set only
// what it changes would leave the other properties to the base class, and which of two competing
// utilities wins is decided by Tailwind's output order rather than by the order they are written
// (the same rule the cell dot and the launcher chip are built around).
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
const ROW_BLOCKED =
  "border-border border-l-[#f59e0b] bg-[color-mix(in_srgb,#f59e0b_14%,var(--bg-panel))] shadow-[0_0_0_2px_color-mix(in_srgb,#f59e0b_60%,transparent)]";
const ROW_DONE =
  "border-border border-l-[#22c55e] bg-[color-mix(in_srgb,#22c55e_8%,var(--bg-panel))] shadow-[0_0_0_1px_color-mix(in_srgb,#22c55e_45%,transparent)]";
// The row you are looking at, and a row with nothing to say — both unchanged by this feature.
const ROW_EXPANDED = "border-[#4a9eff] border-l-[#4a9eff] bg-panel";
const ROW_PLAIN = "border-border border-l-transparent bg-panel";

interface RosterAlertContext {
  // The row whose terminal is enlarged beside the list. It never alerts: a session you are
  // watching shows its own prompt, and its left edge already means "you are here" — one line
  // carrying two meanings is what made the status hard to read in the first place.
  expanded: boolean;
  // The user's setting (default on). Off leaves both states their still colours, which is the
  // point of the switch: the row stays findable, it just stops moving.
  blink: boolean;
}

export function rosterAlertClass(status: AttentionStatus, { expanded, blink }: RosterAlertContext): string {
  if (expanded) return ROW_EXPANDED;
  if (status === "blocked") return blink ? `${ROW_BLOCKED} ${ROW_BLINK}` : ROW_BLOCKED;
  if (status === "done") return ROW_DONE;
  return ROW_PLAIN;
}
