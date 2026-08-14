import type { AttentionStatus } from "./attentionStatus";

// The cockpit roster row's "whose turn is it" chrome (#1131).
//
// The row used to say its status in an 8px dot and a 10px badge, both sitting on a bar painted
// with the DIRECTORY's configured colour — so an amber-ish directory swallowed the amber of
// `waiting`, the same collision the launcher chips had in #1106. The row's own channels (a 3px
// left edge, the wash) were spent on something else entirely: which row is expanded.
//
// There are three channels now, and the words below name them exactly:
//   RING   the 2px box-shadow OUTSIDE the row. Present on every branch, always 2px, and the only
//          one carrying full-strength colour. This is the status.
//   FRAME  the 1px `border`, uniform on all four sides. Neutral everywhere except the expanded
//          row, where it goes blue and closes the ring into one solid 3px band.
//   WASH   the row's background, the same hue again at 8-16%.
//
// There used to be a fourth — a 3px `border-l` STRIPE carrying the status colour at full strength,
// inherited unexplained from the roster's first prototype (6f158893). It is gone. Two things were
// wrong with it once the ring existed: the left side read 2px+3px of one hue against 3px on the
// other three, so the frame looked mis-drawn (the ring/stripe pair fused into a single fat bar on
// the expanded row, where both were solid blue); and where the two greens differed in strength the
// stripe read as colour bleeding INSIDE the ring rather than as a channel of its own. The ring
// says everything the stripe said, at the same strength, all the way round the row. Do not
// re-add a `border-l-*` here — a status colour on one side only is what this replaced.
//
// So the status moves out to the row scale, in two strengths:
//   blocked -> nothing proceeds until you answer  -> amber, and it MOVES
//   done    -> the turn ended, it wants reading   -> green, and it holds still
//
// Motion is deliberately spent on `blocked` alone. The roster already animates a spinner on a
// working row, so a second moving thing is a real cost — paid only for the state where the user
// is what the work waits on, and switchable off (see useRosterAlert).
//
// Every branch names the frame colour, the ring, the background AND the hover background. A
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
//
// EVERY branch rings at the SAME 2px, including the ones with nothing to say, which ring in
// `transparent`. The widths used to differ per state — 2px blocked, 1px done, none on the other
// three — and stacked in a list that reads as one column of cards, three ring weights look like a
// rendering bug rather than three meanings: the eye reads the WIDTH difference before it reads the
// colour, so a green row beside a blue one looked mis-drawn rather than differently stated. The
// ring is a box-shadow, so a transparent one costs no layout and keeps the geometry identical.
// Colour is the only channel a status is allowed to move.
//
// And the ring's colour is now the FULL token — `var(--done)`, `#f59e0b` — not a mix of it with
// transparent. It took the stripe's job when the stripe was removed, so it takes the stripe's
// strength with it: the mixes (45% / 60%) existed to sit quieter than a solid line that was
// already saying the same thing 2px further in, and with that line gone they only made the one
// remaining mark of the status weaker than the mark it replaced.
//
// Each ring is spelled out in full rather than built from a shared `ring(color)` helper: Tailwind
// finds classes by scanning this file's TEXT, so a class assembled at runtime is a class it never
// generates — the row would simply have no ring, with nothing failing anywhere.
const ROW_BLOCKED =
  "mr-1.5 border-border bg-[color-mix(in_srgb,#f59e0b_14%,var(--bg-panel))] hover:bg-[color-mix(in_srgb,#f59e0b_24%,var(--bg-panel))] shadow-[0_0_0_2px_#f59e0b]";
// The green is --done, the token the grid cell's own `done` chrome names too (cellStatusClasses.ts).
// It was this file's literal #22c55e while the cell ringed `done` in the theme accent, so the same
// session changed colour when you enlarged it (#1307).
const ROW_DONE =
  "mr-1.5 border-border bg-[color-mix(in_srgb,var(--done)_8%,var(--bg-panel))] hover:bg-[color-mix(in_srgb,var(--done)_18%,var(--bg-panel))] shadow-[0_0_0_2px_var(--done)]";
// The row you are looking at. It is the LOUDEST branch here, and that ordering is on purpose: it
// used to be the quietest — a 1px blue frame and the theme's own background, no ring and no wash —
// while `done` beside it carried a coloured ring AND a tinted body. So the list answered "which of
// these finished?" more clearly than "which one am I in?", and finding your place meant reading the
// terminal on the right and matching it back. Navigation outranks status in a list you navigate
// with, so this row gets a channel none of the others use: its FRAME takes the same blue as its
// ring, and the two read as one solid 3px band where a status row shows 2px of colour and then a
// neutral hairline. Plus the strongest wash. Since the stripe went, that frame is the whole of
// what separates the cursor from a status — do not neutralise it to "match the others".
//
// And its SHAPE, which is the part colour could not do. Widening this ring to 3px was tried first
// and did not work: the list is already saturated — every row carries a directory-coloured header
// bar and a full-strength status ring — so one more blue band among amber and green asks the eye
// to answer "which blue?" before it can answer "where am I?". Colour was the wrong channel, not
// the wrong amount of it. So the row opens on its RIGHT instead: square corners, and no right
// gutter, which runs it flush to the roster's edge and hard against the splitter the enlarged
// terminal begins after. It stops reading as "the selected item" and starts reading as "this row
// IS the terminal beside it", which is the question actually being asked. The other three sides
// keep the ring, so the status still gets said.
//
// This is why every OTHER branch names `mr-1.5` and the aside carries `pr-0` (TerminalGrid.vue).
// The gutter is a property of the rows that have one, not of the container — the first version put
// 6px of padding on the aside and cancelled it here with `-mr-1`, and a negative margin tuned to a
// padding it cannot see mis-aligns silently the moment that padding changes. It also could not
// reach the edge: 4px was the most that fit before `overflow-y-auto` (which resolves overflow-x to
// `auto`) clipped the row and threatened a horizontal scrollbar, leaving 2px of `bg-deep` that kept
// the row reading as a card near the edge rather than one joined to what is past it.
//
// The right 2px of this row's ring IS clipped by that same overflow, and that is the intent, not a
// side effect: a box-shadow never counts toward scrollable overflow, so nothing scrolls, and what
// gets cut is exactly the segment that would otherwise close the shape back up.
//
// `border-r-[3px]` pays for that clip. Everywhere else this row reads as a 3px band — 1px of frame
// plus 2px of ring — and with the ring's right segment gone, the right edge was left showing the
// frame's 1px alone, which looked like a mis-drawn border rather than an opening. The border takes
// over the missing 2px so all four sides are 3px, and only the CORNERS say the row is open. It is
// the one place a per-side border width is right here, and it is not the `border-l-*` stripe this
// file forbids: that carried a status COLOUR on one side, where this only restores a thickness the
// other three sides already have. Like `rounded-r-none`, it beats the base class's `border` on
// Tailwind's output order (per-side longhands are emitted after the shorthand) — verified against
// this repo's v4, same as the radius.
//
// `ml-1.5` is the 6px it gave up on the right, taken back on the left. So the row is the same WIDTH
// as every other one and simply sits 6px further over — a shift, which the eye reads as one motion
// toward the terminal, rather than a stretch, which reads as this row being bigger than its
// neighbours. Size would compete with the status ring for "how much does this row matter";
// position does not, because no status can move a row sideways.
//
// `rounded-r-none` overrides the `rounded-lg` on the row's base class in TerminalGrid.vue, and
// that is order-dependent the way everything else in this file is — verified against this repo's
// Tailwind (v4): the per-corner longhands are emitted after the shorthand, so this wins.
const ROW_EXPANDED =
  "ml-1.5 rounded-r-none border-r-[3px] border-[#4a9eff] bg-[color-mix(in_srgb,#4a9eff_16%,var(--bg-panel))] hover:bg-[color-mix(in_srgb,#4a9eff_16%,var(--bg-panel))] shadow-[0_0_0_2px_#4a9eff]";
// The hover above is deliberately the SAME colour as the resting state, not a step up from it: the
// click handler skips the expanded row (you are already there), so a row that lit under the pointer
// would promise something pressing it does not do. It is still named, because a branch that names
// no hover inherits nothing and Tailwind's order, not this file's, decides what wins.
const ROW_PLAIN = "mr-1.5 border-border bg-panel hover:bg-hover shadow-[0_0_0_2px_transparent]";
// A row the user has set aside (#992). It names the same frame, ring and background as a plain
// row and sinks with `opacity` — the one property no branch above sets, so the two never race.
const ROW_PARKED = `${ROW_PLAIN} opacity-45`;
// Parked AND the row being looked at. The blue ring is NAVIGATION — "you are here" — so it stays;
// the sink is the STATE, so it stays too. Dropping either would answer a different question than
// the one that was asked: selecting a parked session must not make it read as awake.
const ROW_PARKED_EXPANDED = `${ROW_EXPANDED} opacity-45`;

interface RosterAlertContext {
  // The row whose terminal is enlarged beside the list. It never alerts: a session you are
  // watching shows its own prompt, and its ring already means "you are here" — one mark
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
