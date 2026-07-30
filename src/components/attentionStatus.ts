// Whose turn it is on a session, for every panel that lists sessions: the grid's cells, the
// cockpit roster, the sidebar and the tab bar.
//
// It lived in `gridTabs.ts` as `CellStatus` while the grid was the only reader. The sidebar and the
// tab bar need the same split (#1139) and a session row is not a cell, so the rule moves here —
// the same reason `cellPriority` moved out to `dirPriorityOrder.ts` in #1098 once the launcher
// chips had to order themselves the way the grid does.
//
// `blocked` (needs input or permission) and `done` (finished a turn, output unreviewed) both arrive
// as the server's one `waiting` flag; only the hook that set it tells them apart. Keeping that
// distinction in one function is what stops two panels from disagreeing about what a row means.
export type AttentionStatus = "blocked" | "done" | "working" | "idle";

// `waiting` means "needs the user"; the `event` that set it distinguishes a permission/question
// pause ("Notification" → blocked, the most urgent) from a finished-but-unreviewed turn
// ("Stop" → done). Anything else waiting — an older agent that sends no event, a hook we do not
// model — reads as done: it is the safer of the two, since it does not claim the session is stuck.
export function activityStatus(working: boolean, waiting: boolean, event: string | null | undefined): AttentionStatus {
  if (waiting) return event === "Notification" ? "blocked" : "done";
  if (working) return "working";
  return "idle";
}
