# The other two readers that fold a transcript every time (#1386)

`readSessionMeta` stopped re-reading its transcripts in #1379, and #1387 put that fold beside the
file. Two readers were left doing the whole thing on every request, with **no cache at all**:

- **`/api/cost`** reads up to 200 of a project's transcripts to total them — 2.4 s on this machine's
  1.1 GB project, every time the cost panel is opened.
- **the timeline overlay** reads a whole transcript to keep the newest 300 events — 2.2 s on a
  508 MB session, every time it is opened.

Both are plain folds over records, and both fold into state that serialises as it stands. They are
the two cheapest wins left on #1386, and they come before `readSessionSummary`, whose scan keeps RAW
records and needs restructuring first.

## The third copy is where the helper goes

Wiring a reader up means: resume from memory, else from the sidecar, else fold; then write both
back. Written once it is a paragraph, written three times it is a paragraph that can drift — and
the duplication scan would say so.

**`server/session/transcript-fold.ts`** — `createTranscriptFold({ kind, version, isValue, empty,
fold, copy, cold? })`, returning `read(transcript, stamp)`. `readSessionMeta` moves onto it with no
behaviour change (its head+tail first read becomes the optional `cold` hook, which answers `null`
when it cannot answer exactly).

`copy` is **required rather than defaulted to a spread**. A value holding a collection needs that
collection copied too: the timeline's accumulator owns an array that a resumed fold pushes into,
and the value it was copied from has already been handed to a caller. A default would have made
that the quiet case rather than the decided one.

## What each one folds

| reader | state | version |
| --- | --- | --- |
| title fields | three strings | `title-fields` v1 |
| cost | `{ usd, unpricedTurns }` | `cost` v1 |
| timeline | the newest 300 events + how many there have been | `timeline` v1 |

`total` in the timeline's state is not the length of `events` — it counts every event the transcript
ever had, which is the only thing that can still answer "was this truncated?" after the window has
dropped the rest.

The cost fold moves out of `createCostScan`'s closure into `foldCost(into, record)`, which the scan
then uses: a resumed read folds into a total it did not start, so both paths have to add a turn the
same way or a resumed cost drifts from a fresh one. `sessionCost(cwd, id)` is now exported, so the
route stops building the transcript path itself and the fold underneath it is testable without an
HTTP request.

`rollupProjectCost` already stats every file to bucket it by day; it now carries the size along and
hands the stamp down, rather than making the fold stat 200 files a second time.

## Measured

Against the real 1.1 GB project (its biggest session is 508 MB), before and after:

| | before, every call | after, first call | after, later calls |
| --- | --- | --- | --- |
| timeline overlay | 2,247 ms | 2,202 ms | **0 ms** |
| `/api/cost` | 2,449 ms | 2,323 ms | **1 ms** |

And in a SECOND process, with the sidecars already on disk — a restart, or the next mulmoterminal:

| | first call |
| --- | --- |
| timeline overlay | **13 ms** |
| `/api/cost` | **3 ms** |

The first call is not faster on its own, and should not be: unlike the title fields, neither of
these can be answered from part of a transcript — a total has to see every turn, and the newest 300
events are only known once the file has been read. What changes is that it is paid **once**.

## Tests

`test/server/session/transcript-fold.spec.ts` — the shared machinery, which no caller can see: a
resumed fold equals one uninterrupted pass, an already-returned value is not mutated by the next
read, a shorter file folds from scratch, and the `cold` hook is used when it answers / fallen back
on when it returns null.

`test/server/session/timeline-fold.spec.ts` — the window still means the newest 300 with `truncated`
counting all of them; a resumed fold past the cap equals one pass; an unchanged transcript is not
read twice (proven by changing its bytes under a held (size, mtime)).

`test/server/session/cost.spec.ts` — an append adds to the total already held; a resumed total
equals a one-pass total; a missing transcript costs nothing.

## Not in scope

`readSessionSummary` — the one that hurts most (10.5 s per turn on an active 508 MB session), and
the one that cannot move onto this helper until its scan stops keeping raw records. Left on #1386.
