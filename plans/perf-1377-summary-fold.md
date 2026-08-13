# The summary re-read the whole transcript on every turn (#1377)

`/api/session/:id` is hit by every grid cell as its turn finishes. Its reader, `readSessionSummary`,
had a `(mtime, size)` memo — which can only skip an **unchanged** transcript, and the session being
written to is never that. So the session you are actively working in, the one most likely to be
huge, paid a full read per turn: **2.15 s on a 508 MB transcript**, with the event loop stopped and
every terminal in the app frozen for it.

The other three readers moved onto a resumed fold in #1379/#1387/#1392. This one could not follow,
because its scan keeps **raw records**:

- every `user` record ever seen (13,664 in one transcript here), kept so the latest MEANINGFUL
  prompt could be picked out of them at the end;
- the last `assistant` record, kept so the model and context tokens could be read off it as a unit.

Neither can be written to a sidecar, and holding them across requests is its own problem.

## Resolve as they arrive, without restating the rule

Both are answered by rules that are themselves folds, so the fix is to move the rule — not to
re-derive its answer somewhere else. #998's lesson applies exactly: a second copy of a rule is how
the two answers drift.

**`latestMeaningfulUserPromptFromParsed`** picks the last non-trivial prompt, falling back to the
last prompt at all, then to a `last-prompt` record. Each of those is a *last X*, so the whole rule
needs three strings — not every record:

```
PromptTrail { meaningful, latest, record }   // transcript.ts
foldPromptTrail(trail, record)               // one rule
meaningfulPromptOf(trail)                    // one choice
```

The array helpers (`latestMeaningfulUserPromptFromParsed`, `latestUserPromptFromParsed`) now fold the
same function over their records, so there is one implementation and the streaming caller cannot
answer differently. The 54 existing `transcript.spec.ts` cases pass unchanged — that is what says the
refactor kept the rule.

**The context** (model + context tokens) is resolved per assistant record by the same
`latestTurnContextFromParsed` one-record window that used to be applied at the end. Unconditional
replacement, matching what keeping the last record did, so a turn naming no model still reports null
rather than an earlier turn's model.

`createCurrentTurnToolScan` becomes `foldTurnToolNames(names, record)` for the same reason — the
scan is now a thin wrapper over it.

## Shape

`summary-scan.ts` exposes the fold instead of a closure over it: `emptySummaryState`,
`foldSummary(state, record)`, `copySummaryState`, `summaryPartsOf(state, max)`. `createSummaryScan()`
stays for the array callers, built from those. The state is JSON: four usage numbers, a count, two
strings, the prompt trail, the resolved context, and the current turn's tool names.

`readSessionSummary` then drops its own memo and reads through `createTranscriptFold` (kind
`summary`), which brings the in-memory resume AND the sidecar with it.

## Measured

`readSessionSummary` against the biggest real transcript here (508 MB), on a copy so the real one is
never touched:

| | before | after |
| --- | --- | --- |
| first read | 2,176 ms | 2,162 ms |
| unchanged file | 0 ms | 1 ms |
| **after a turn is appended** | **2,154 ms** | **3 ms** |
| after another turn | 2,158 ms | 0 ms |

The first read is unchanged and should be: a summary counts every turn, so nothing less than the
whole file can answer it the first time. What changed is the row that a working session actually
hits — every turn, in every cell.

## Tests

`test/server/session/summary-scan.spec.ts` — the existing cases already assert the scan against the
original `*FromParsed` functions on the same records, so they pin the refactor. Added: folding cut at
**every** position equals one uninterrupted pass; the state a resume continues from is left
untouched; and the state survives a round trip through JSON (which is what a sidecar is).

`test/server/session/session-summary-fold.spec.ts` — through `readSessionSummary`: a continued fold
across a turn equals a one-pass read, an unchanged transcript is not read twice (bytes changed under
a held stamp), and a big session's summary is written beside it and continued **in a fresh process**.

`test/server/session/transcript.spec.ts` — unchanged, and passing, which is the point.

## Not in scope

The `lastAssistantText` in the state is the full reply, sliced to 400 chars only when the summary is
built. For a sidecar that is a few KB of the value; capping it at fold time would tie the state to
one caller's `responseMax`, which is not a trade worth making for the size.
