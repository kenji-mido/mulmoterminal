import { computed } from "vue";
import { isBackground, isUnread, matchesFilter, type Session, type Filter } from "./useSessions";
import type { TerminalAgent } from "../../common/sessionAgent";
import { activityStatus, type AttentionStatus } from "../components/attentionStatus";

// The "Claude is working" ring both layouts show, as utilities rather than a `.spinner` rule in
// each component's <style> — which is how the two ended up defining the same class name with
// different values. `animate-spin` is Tailwind's own (1s, was a hand-rolled 0.9s keyframes here);
// the layouts add their own margin/alignment, which is all they ever differed by.
export const SESSION_SPINNER = "size-2.5 rounded-full border-2 border-[color-mix(in_srgb,var(--accent)_30%,transparent)] border-t-[var(--accent)] animate-spin";

// The dot that says WHICH kind of attention a row wants (#1139).
//
// Both layouts marked "needs you" with weight alone — bold text here, one red dot in the tab bar —
// for BOTH states the server's `waiting` flag covers. A row stopped on a permission prompt (nothing
// happens until you answer) looked exactly like one that had merely finished a turn (read it
// whenever). The grid and the cockpit roster already split those; this is the same split, in the one
// channel these narrow rows have to spare.
//
// Hues match the roster (rosterAlertClasses.ts) so a session means the same thing in every panel.
// Deliberately NOT animated: unlike the roster, which is on screen only while a cell is enlarged,
// these two are always there — a permanent pulse is the annoyance the roster's setting exists to
// switch off. Bold still marks both states, so the dot refines rather than carries the signal.
const SESSION_DOT_BASE = "size-[7px] shrink-0 rounded-full";
const SESSION_DOT: Partial<Record<AttentionStatus, { hue: string; label: string }>> = {
  blocked: { hue: "bg-[#f59e0b]", label: "Waiting for you" },
  done: { hue: "bg-[#22c55e]", label: "Finished — unread" },
};

export interface SessionDot {
  cls: string;
  label: string;
}

/** The dot for a status, or null where there is none: `working` has the spinner in that slot (the
 *  two cannot co-occur) and `idle` has nothing to say. The label is not optional — colour is the
 *  entire message for a sighted user, so without it the split would be invisible to anyone who
 *  cannot see it. */
function statusDot(status: AttentionStatus): SessionDot | null {
  const dot = SESSION_DOT[status];
  return dot ? { cls: `${SESSION_DOT_BASE} ${dot.hue}`, label: dot.label } : null;
}

/** A row's status, from the same rule the grid and the roster read. */
export const sessionAttention = (s: Session): AttentionStatus => activityStatus(!!s.working, !!s.waiting, s.event);

/** The dot a ROW should carry, which is not the same question as what its status is: the gate is
 *  `isUnread`, so which rows get marked stays exactly what it was — a background worker is
 *  deliberately never marked, and it is `isUnread` that also drives the bold and the Unread chip.
 *  Reading the status alone here would put a dot on a hidden row that has no bold, which is the
 *  same contradiction this change exists to remove, one channel over. */
export const sessionDotFor = (s: Session): SessionDot | null => (isUnread(s) ? statusDot(sessionAttention(s)) : null);

// The event contract App.vue wires to both session-list layouts (the vertical
// Sidebar and the horizontal SessionTabBar); v-model:filter drives update:filter.
export type SessionListEmits = {
  (e: "select", id: string, agent: TerminalAgent): void;
  (e: "new" | "new-codex" | "new-antigravity" | "toggle-layout" | "refresh"): void;
  (e: "hide" | "delete", id: string): void;
  (e: "update:filter", f: Filter): void;
};

// What App.vue hands a session-list layout. The event half of this contract has been named
// since both layouts were written; the props half was left inline in each of them, which is
// how the same three lines ended up in both components (#646 B2).
export interface SessionListProps {
  sessions: Session[];
  activeId: string | null;
  filter: Filter;
}

// The chips' counts and the filter-applied list, shared by both layouts.
// The horizontal bar caps `filteredSessions` to its most-recent tabs itself.
// `isUnread` rides along because both layouts also mark rows with it — one import
// gets a layout everything the session-list contract offers.
export function useSessionFilter(props: Pick<SessionListProps, "sessions" | "filter">) {
  const unreadCount = computed(() => props.sessions.filter(isUnread).length);
  const backgroundCount = computed(() => props.sessions.filter(isBackground).length);
  const filteredSessions = computed(() => props.sessions.filter((s) => matchesFilter(s, props.filter)));
  return { unreadCount, backgroundCount, filteredSessions, isUnread };
}

// What to say when the server returned sessions but the chip matched none of them. The
// default chip can land here too: a project whose only sessions are background workers has
// rows to list and no chats, which "No sessions yet" would report as an empty project.
export function sessionListEmptyMessage(filter: Filter): string {
  if (filter === "unread") return "No unread sessions";
  if (filter === "background") return "No background sessions";
  return "No chat sessions";
}
