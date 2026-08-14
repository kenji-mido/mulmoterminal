// The periodic dev-work log's cadence, in hours. In `common/` because BOTH sides decide from it:
// the server clamps what it loads, and the Settings stepper has to offer the same range — a
// browser-side copy of the bounds would drift the moment one of them changed.
export const DEFAULT_WORKLOG_INTERVAL_HOURS = 6;
export const MIN_WORKLOG_INTERVAL_HOURS = 1;
export const MAX_WORKLOG_INTERVAL_HOURS = 168; // one week

// Positive whole hours, clamped to [MIN, MAX]. Anything else falls back to the default.
export function sanitizeWorklogIntervalHours(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return DEFAULT_WORKLOG_INTERVAL_HOURS;
  return Math.min(MAX_WORKLOG_INTERVAL_HOURS, Math.max(MIN_WORKLOG_INTERVAL_HOURS, Math.round(input)));
}
