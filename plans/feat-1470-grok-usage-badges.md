# feat(#1470): the ctx and token badges for a Grok cell

## What was wrong

#1465 shipped saying grok records no tokens:

> grok — the model only. `summary.json` names it; a conversation directory holds no token
> accounting at all (the only `token` fields in one are `first_token` timings and a WebFetch tool
> parameter), so the usage badge stays hidden.

True of the two files it read. False of the directory.

## What grok actually writes

Measured against grok **0.2.118**, over 13 real conversations under
`~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/`. 12 of the 13 have both files; the one that
does not is a directory grok created and never wrote a turn into.

### `signals.json` — the context reading

Rewritten whole each turn. The fields that matter:

```json
{ "contextWindowUsage": 33, "contextTokensUsed": 167417, "contextWindowTokens": 500000,
  "primaryModelId": "grok-4.5", "compactionCount": 0, "modelsUsed": ["grok-4.5"] }
```

`contextTokensUsed` is what will be re-sent for the next turn — the same question Claude's
`contextTokens` answers. It cross-checks exactly against the running `_meta.totalTokens` grok
stamps on the last `updates.jsonl` record it wrote (51,537 in both, on the session used to develop
this).

`contextWindowTokens` is the model's real window, **stated by the agent**, so it travels on
`contextWindow` and the client's substring table is never consulted — the same win codex's
`model_context_window` gave, and the table is what read a 1M model against a 200k window in #985.

### `updates.jsonl` — the token counts

One `turn_completed` record per turn:

```json
{"method":"_x.ai/session/update","params":{"update":{"sessionUpdate":"turn_completed",
  "usage":{"inputTokens":301569,"outputTokens":3036,"totalTokens":304605,
           "cachedReadTokens":260992,"cacheCreationTokens":0,"reasoningTokens":1924,
           "modelCalls":8,"costUsdTicks":1776676000}}}}
```

**PER TURN, not cumulative.** Sixteen consecutive turns of one conversation ran 74k, 109k, 98k,
192k, 263k, 198k, 329k … — they rise and fall, which is what rules out codex's trick of reading
the tail and calling the last record the total.

`totalTokens` = `inputTokens` + `outputTokens`, and `cachedReadTokens` is a **subset of the
input**. The badge adds its three input fields together, so the cached part is MOVED out of
`inputTokens` rather than added beside it: same sum, and the tooltip gains a real cache breakdown
(codex's reader put the whole input in one field and lost that). `cacheCreationTokens` is left
uncounted — it has been 0 in every turn measured, so whether it sits inside the input or beside it
is unverified, and counting it could double what the badge shows.

## Why the whole file is affordable

Per-turn means the session total is the SUM, which means the whole file, on a route polled per
cell. `createTranscriptFold` (#1377 / #1386) is exactly that case: the value is folded once, the
byte offset is remembered, and a later poll pays only for the bytes the last turn appended. A
conversation big enough for a sidecar keeps its total on disk, so a restart does not pay again.

## Shape

- `server/agents/grok-usage.ts` — new, pure: `grokContextFromSignals`, `foldGrokUsage`.
- `server/agents/grok-sessions.ts` — `grokSignalsPath`, `grokUpdatesPath` beside `grokSummaryPath`.
- `server/session/agent-badges.ts` — `grokBadges` reads the three files in parallel and folds the
  updates. Model: `current_model_id` from the summary first (what it is running NOW), signals'
  `primaryModelId` (what it has mostly run under) only as the fallback for a conversation whose
  summary has not been written yet — they differ for the rest of a session after `/model`.
- `src/components/TerminalCell.vue` — grok joins agy in the untracked-badge poll, and nothing
  else: the badges themselves have been agent-agnostic since #1465, so only their inputs were
  empty. See "Keeping it live".

## Keeping it live

grok has no activity tracker and publishes no hooks, so nothing calls `setWorking` for a grok
cell — which means the `working -> idle` watch that re-reads every other agent's badges never
fires, and neither does `refreshBadgesIfModelUnknown` (it needs an activity push). A first read
taken as the cell announced its id would then be the only one the session ever got: `ctx 0%`, or
no badge at all, for the rest of it (Codex review).

The substitute already existed for agy, which has the same gap: `UNTRACKED_BADGE_POLL_MS` in
`TerminalCell.vue`. grok joins it — the set is now `{antigravity, grok}`, one `/api/session` read
per untracked cell per minute, and for grok that read is two small JSON files plus a fold resumed
at the byte the last poll stopped on. It goes away for grok the day grok gets a tracker, exactly
as agy's does.

## Not done

- **Cost.** `costUsdTicks` is in every `turn_completed` record (1 tick = 1e-9 USD by the numbers:
  1,776,676,000 ticks ≈ $1.78 for 300k tokens on grok-4.5). The cost panel is Claude-only and
  wiring a second agent into it is its own change, not a badge.
- **Compaction.** `signals.json` carries `compactionCount` and `totalTokensBeforeCompaction`;
  no conversation on this machine has compacted, so what `contextTokensUsed` does across one is
  unverified. It is grok's own number either way — nothing here recomputes it.
