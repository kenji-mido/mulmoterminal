// Per-minute request budget for the token-scoped custom-view endpoints —
// MulmoTerminal's port of MulmoClaude's `makeViewActionRateLimiter`
// (server/api/routes/collections.ts).
//
// The view token already bounds WHAT a sandboxed iframe may touch (one slug,
// read/write); this bounds HOW OFTEN. Each of the endpoints behind it costs a
// full record scan plus real work (a mutate write, a thumbnail decode), so a
// runaway `onChange` loop in LLM-authored HTML must not be able to spin the
// host. Keyed by IP + slug, fixed window, in memory: the same shape as
// MulmoClaude's, so a view that behaves on one host behaves on the other.
import type { Request, Response, NextFunction } from "express";

/** Entries are swept lazily, when the map grows past this. */
const SWEEP_THRESHOLD = 1000;

export const ONE_MINUTE_MS = 60_000;

/** `max` requests per `windowMs` per (IP, slug). `now` is injectable so the
 *  spec can drive the window without waiting on a real clock. */
export function makeViewActionRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;
  return (req: Request<{ slug?: string }>, res: Response, next: NextFunction): void => {
    const nowMs = now();
    // Deliberate divergence from MulmoClaude, which gates this on map size alone:
    // the limiter runs BEFORE `requireViewToken`, so unauthenticated requests
    // create entries too. Past the threshold with every entry still inside its
    // window, a size-only gate sweeps on every request and deletes nothing —
    // O(n) per request while the map keeps growing. Sweeping at most once per
    // window bounds that; the rate decisions below are unchanged either way.
    if (hits.size > SWEEP_THRESHOLD && nowMs >= nextSweepAt) {
      nextSweepAt = nowMs + windowMs;
      for (const [key, entry] of hits) if (entry.resetAt <= nowMs) hits.delete(key);
    }
    const key = `${req.ip ?? ""}\n${req.params.slug ?? ""}`;
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      hits.set(key, { count: 1, resetAt: nowMs + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ error: "rate limit exceeded — retry shortly" });
      return;
    }
    next();
  };
}

/** Mutate actions and aggregation queries share one budget. */
export const VIEW_ACTION_RATE_LIMIT_PER_MINUTE = 60;

/** Image thumbnails get their own, roomier bucket: a gallery legitimately fetches
 *  dozens of images on first paint, so the action budget would starve it — while
 *  the endpoint still needs a ceiling (record scan + thumbnail decode each). */
export const VIEW_IMAGE_RATE_LIMIT_PER_MINUTE = 300;
