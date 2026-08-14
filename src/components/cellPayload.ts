// The two payload shapes a cell believes without asking anyone: the token usage and the
import { isRecord } from "../../common/isRecord";
import type { SessionContextInfo } from "../../common/sessionContext";
// running model/context that back its header badges.
//
// They arrive from /api/session/:id and the cost route, and the guards only asked whether a
// key was PRESENT. `{ outputTokens: null }` — a field the server could not compute, or a
// version skew — passed, and the badge rendered NaN. A guard that admits a shape it cannot
// render is not doing the job the guard exists for (#611).
//
// Pure and separate so the shapes can be checked against what a server actually sends,
// rather than only through a mounted cell.

export interface CellUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// The wire shape itself (common/sessionContext.ts) — the server answers it and this file only
// says whether what arrived is renderable.
export type CellContext = SessionContextInfo;

// Rendered as a number, so it has to be one: NaN and Infinity read as a broken badge just as
// a string would.
const isRenderableCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const asRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

export function isCellUsage(value: unknown): value is CellUsage {
  const usage = asRecord(value);
  if (!usage) return false;
  // Every field is shown, so a missing one is a badge with a hole in it — not a partial
  // update worth taking.
  return (
    isRenderableCount(usage.inputTokens) &&
    isRenderableCount(usage.outputTokens) &&
    isRenderableCount(usage.cacheReadTokens) &&
    isRenderableCount(usage.cacheCreationTokens)
  );
}

export function isCellContext(value: unknown): value is CellContext {
  const context = asRecord(value);
  if (!context) return false;
  // `model` is legitimately null before the first assistant turn — that hides the badge,
  // which is different from the field being the wrong type.
  const modelOk = context.model === null || typeof context.model === "string";
  // Optional on the wire: only the agents that state a window send it (codex). Absent and null
  // both mean "nobody told us" and are fine; a NaN or a string is the broken shape this guard is
  // for — it would divide into a percentage.
  const windowOk = context.contextWindow === undefined || context.contextWindow === null || isRenderableCount(context.contextWindow);
  return modelOk && windowOk && isRenderableCount(context.contextTokens);
}
