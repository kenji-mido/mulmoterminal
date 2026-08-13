// Whether a chunk heading for the PTY means "the user typed something", as opposed to the
// terminal telling the app where the pointer went or that focus moved.
//
// Everything the terminal sends travels one channel, so "input arrived" and "the user typed" are
// NOT the same question — and code that needs the second one gets the first by default. A parked
// cell wakes on the user typing (#992): clicking it to read it must leave it parked, and clicking
// is exactly what a mouse-tracking app turns into input.
import { isMouseReport } from "./mouseReports";

// Focus tracking (mode 1004): the terminal reports focus gained / lost. Clicking a cell moves
// focus, so an app that asked for this would otherwise wake the cell through the back door — the
// same way the pointer reports did before they were excluded.
const FOCUS_REPORTS: ReadonlySet<string> = new Set(["\x1b[I", "\x1b[O"]);

export function isTypedInput(data: string): boolean {
  return !isMouseReport(data) && !FOCUS_REPORTS.has(data);
}
