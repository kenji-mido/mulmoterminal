// Which model a session is running and how full its context is: the `context` object
// GET /api/session/:id answers with, and the thing the header's model badge renders.
//
// In `common/` because BOTH sides decide from it. The server fills it from whichever log the
// session's agent keeps, and the client decides from `contextWindow` whether to trust the agent's
// own window or fall back to its per-model table (`src/components/modelBadge.ts`). It was mirrored
// as `LatestTurnContext` on the server and `CellContext` in the UI; both are now this.
export interface SessionContextInfo {
  /** null until a turn has told us — a session that has not answered yet wears no badge. */
  model: string | null;
  /** Tokens re-sent as context for the NEXT turn, off the most recent completed turn. */
  contextTokens: number;
  /**
   * The model's context window, when the AGENT ITSELF reports one. codex writes
   * `model_context_window` into every `token_count` event, grok `contextWindowTokens` into its
   * `signals.json` and agy the window into its accounting store, which is better than any table we
   * can keep: the substring list in
   * modelBadge.ts has already claimed a model whose window it had wrong (#985), and nothing on
   * this side can notice when a provider changes one.
   *
   * Absent (or null) means nobody told us, NOT "no window" — the client falls back to its table.
   */
  contextWindow?: number | null;
}
