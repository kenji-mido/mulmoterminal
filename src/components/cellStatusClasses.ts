// What a grid CELL looks like in each of the four attention states — frame, header, dot.
//
// It lived inside TerminalCell's `<script setup>`, which no spec can import. The roster paints the
// same four states from its own file (rosterAlertClasses.ts), and the two disagreed about `done`
// for as long as nothing could compare them (#1307): the cell ringed it in the theme accent while
// the roster pilled it green, so enlarging a session changed the colour of "finished". Both sides
// now name --done, and a spec holds them to it.
//
// The two files stay separate on purpose — a roster row is not a cell (docs/grid-view-modes.md),
// and they are short of different things. What is shared is the colour, not the chrome.
import type { AttentionStatus } from "./attentionStatus";
import { CELL_DOT_IDLE, CELL_DOT_WORKING } from "./cellChromeClasses";

// The header colour rides along in the non-blocked branches so two text utilities never race for
// the same element.
const HEADER_FG = "text-[var(--cell-header-fg,inherit)]";

export const CELL_STATUS = {
  // Idle keeps the per-dir --cell-border override; the active states deliberately replace it.
  idle: "border-[var(--cell-border,var(--border))]",
  working: "border-accent",
  done: "border-done shadow-[0_0_0_2px_color-mix(in_srgb,var(--done)_40%,transparent)]",
  blocked: "border-amber shadow-[0_0_0_2px_color-mix(in_srgb,var(--amber)_55%,transparent)]",
} as const satisfies Record<AttentionStatus, string>;

// `done` mixes its own wash rather than reusing `bg-selected` like `working`: on a tile the frame
// is thin and the header is a third of what you see, so a header that stayed selection-blue would
// keep the two states looking alike at grid distance — the complaint that started #1307.
// Every state's background goes through --cell-header-bg, with the theme's own wash as the
// var's FALLBACK. The variable is emitted per state (headerStatusStyleFor), so an unconfigured
// cell never sets it in the three active states and the wash below is what paints — while a
// directory that recoloured a status replaces the wash without a second class racing this one.
export const HEADER_STATUS = {
  idle: `bg-[var(--cell-header-bg,var(--bg-panel))] border-b-border ${HEADER_FG}`,
  working: `bg-[var(--cell-header-bg,var(--bg-selected))] border-b-accent ${HEADER_FG}`,
  done: `bg-[var(--cell-header-bg,color-mix(in_srgb,var(--done)_20%,var(--bg-panel)))] border-b-done ${HEADER_FG}`,
  // The ink names --warn rather than inheriting: `blocked` is the one state whose wash carries a
  // meaning of its own, so its text has always been the amber that goes with it. A configured
  // blocked colour still wins, through the same variable every other state uses.
  blocked: "bg-[var(--cell-header-bg,var(--warn-bg-subtle))] border-b-amber text-[var(--cell-header-fg,var(--warn))]",
} as const satisfies Record<AttentionStatus, string>;

// Every state names its own colour: a base tint plus a status tint would be two `bg-*` utilities
// on one element, and Tailwind's output order — not this map — would pick.
export const DOT_STATUS = {
  idle: CELL_DOT_IDLE,
  working: CELL_DOT_WORKING,
  done: "bg-done",
  blocked: "bg-amber",
} as const satisfies Record<AttentionStatus, string>;
