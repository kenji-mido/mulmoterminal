# The session list re-reads every transcript, every request (#1377)

`/api/sessions` costs 4.8 s on a project whose 50 most recent transcripts total 1.1 GB, and 9-20 s
at 2.1 GB — for a 17 KB answer, on a warm cache, every single time. The launcher waits on it, and
`useSessions` refetches it on every "sessions" pub/sub push, so during agent work the server spends
its time re-reading gigabytes it has already read.

The cost is linear in the BYTES of those transcripts (≈4.3 ms/MB measured across four projects),
which is why it looks like it "gets slow over time": the row count never changes, the bytes behind
the rows grow all day.

`readSessionMeta` wants three fields per file — `ai-title`, `last-prompt` (last of each) and the
first `user` message — and streams the whole transcript to get them.

## Why the earlier fix didn't cover this

#998 was about `readFile` **throwing** past ~512 MB. It made this reader streamed (so it stops
reporting an empty title for the biggest sessions) but not cheaper — its own comment says it was
missed by that issue's table. And `createFileCache` — the (mtime, size) memo that makes
`/api/session/:id` go from **10.5 s cold to 4 ms warm** on a 508 MB transcript — was never wired
into this reader.

## Where the three fields actually live

Measured over the 60 largest transcripts on this machine (all >5 MB, up to 508 MB), reading each
one end to end:

| field | rule | worst case | p90 | missing |
| --- | --- | --- | --- | --- |
| first `user` | FIRST wins | 26.6 KB from the start | — | 0/60 |
| `last-prompt` | LAST wins | 30.8 KB from EOF | 10.2 KB | 0/60 |
| `ai-title` | LAST wins | 52.8 KB from EOF | 28.7 KB | 8/60 |

So the answer is at the two ENDS, and the middle — hundreds of megabytes — is read for nothing.

## Fix

Two halves, and neither one guesses.

**Warm: resume, don't re-read.** A transcript is append-only, so the fold that produces those three
fields can be resumed: keep what has been folded plus the byte offset the scan stopped at, and fold
only what was appended since.

- unchanged file → **no read at all**
- grown file → read `[offset, EOF)`, typically kilobytes
- shorter than what we folded (rewritten, cleared) → fold from 0 again

**Cold: read the two ends, and check the answer is complete.** For a file bigger than the two
windows, fold `[0, 256 KB)` and `[size − 512 KB, EOF)` — ~10× the measured worst case on both
sides. Then:

- the head produced a first `user` record, AND the tail produced both `ai-title` and `last-prompt`
  → **the answer is exact**: the tail ran to EOF, so an occurrence found there IS the last one.
- anything missing → **fold the whole file**, exactly as today. A field absent from the window is
  indistinguishable from a field absent from the file, and the reader must not guess which.

That fallback is what keeps this from being a window that paraphrases the rule it replaces (#998's
own lesson). It costs a full read for the 8-in-60 files that never had an `ai-title` — once, since
the result (including "there is none") is then cached.

The two window sizes are named constants with the measurement in the comment, so the next person
can see what they have headroom over.

## Shape

**`server/infra/jsonl-file.ts`** — `forEachJsonlRecordIn(file, range, onRecord)`: folds the records
in `[from, to)` (EOF when `to` is omitted) and answers the offset it stopped at. A LEADING partial
line is dropped unless the caller says `from` is a line boundary, which is exactly the difference
between a resumed scan and a tail read. Byte accounting is done on the raw buffer, splitting on
`\n`, so it cannot drift from what the caller stores.

The last line of a range that ran to EOF is the interesting one, and it is two different things: a
record written without a trailing newline, or half of one still being written. **JSON tells them
apart** — a truncated record does not parse — so a valid one is folded and counted (which is what
`forEachJsonlRecord` does, and equivalence is the whole point), and a broken one is left uncounted
for the next scan to pick up whole. At a `to` boundary the cut is arbitrary, so its last line is
never folded. Treating every newline-less last line as half-written was the first version, and it
would have dropped the final record of any transcript that does not end in a newline — for as long
as the file sat unchanged, which for a finished session is forever (found by CodeRabbit).

**`server/session/file-cache.ts`** — `createAppendFileCache<T>()` beside the existing
`createFileCache<T>()`, sharing its LRU store: `resume(key, stamp)` answers `{ from, value }` when
the file has only grown, and `undefined` when it must be folded from scratch.

**`server/session/session-reads.ts`** — `readSessionMeta` stats first (it needs the size), resumes,
folds only the new bytes, and stores the offset. What is cached is the three **disk** fields only.
The title is still computed per request from those plus the live in-memory maps (`sessionMemos`,
`aiTitles`), and `working` / `waiting` / `hidden` / `failed` still come from the registry — caching
the finished row would freeze a memo edit or an activity flag behind an unchanged file.

## Tests

`test/server/infra/jsonl-file.spec.ts`

- folding `[0, EOF)` equals the whole-file fold (the new reader is not a different rule)
- **equivalence**: fold, append, resume from the returned offset → same result as folding the whole
  grown file in one pass (the check #998 asks for by name)
- a trailing HALF record is not folded, and is folded once the rest of it arrives
- a valid final record with no trailing newline IS folded, and counted, exactly as the unbounded
  reader folds it
- the last line of a window that stops short of EOF is never folded
- a leading partial line is dropped for a window that starts mid-line, and kept when the caller says
  the offset is a line boundary
- the returned offset is the end of the last complete line; CRLF; no trailing newline; empty file;
  missing file

`test/server/session/file-cache.spec.ts`

- resume returns the stored offset for an unchanged and for a grown file
- a shorter file resumes nothing (fold from scratch)
- the entry follows the same LRU bound as `createFileCache`

`test/server/session/session-meta-incremental.spec.ts`

- a second read of an unchanged transcript reads no bytes
- an appended `ai-title` / `last-prompt` is picked up; the first user message survives the resume
- a big file whose ends carry all three is read from the ends only
- a big file MISSING an `ai-title` falls back to the whole file — and still answers the same as the
  unbounded reader (the case the fallback exists for)
- a truncated (cleared) transcript is folded from 0 again
- the title still follows a memo edit while the file is unchanged (what must NOT be cached)

## Measured

`readSessionMeta` over the 50 most recent transcripts of real projects — the same files, the same
function, before and after (before = this branch stashed, so both runs are this machine's own data
and not a synthetic file):

| project | transcripts | before, every call | after, first call | after, later calls |
| --- | --- | --- | --- | --- |
| mulmoterminal4 | 28 MB | 117 ms | 44 ms | **0-1 ms** |
| mulmoclaude3 | 1,135 MB | 4,670 ms | 492 ms | **1 ms** |
| mulmoclaude2 | 2,104 MB | 8,700 ms | 2,057 ms | **0-1 ms** |

The 2 s that remains on mulmoclaude2's first call is the fallback doing its job: **1 of its 20
files** (461 MB) has no `ai-title` record anywhere, and nothing short of reading it can prove that.
Every other file there is answered from its two ends. After that first call the whole list is free
until something is appended, and then it costs the append.

## Verification

Numbers above are the ground truth: the real `~/.claude/projects` data, measured before and after,
not a synthetic file and not another of my own outputs. The tests pin the equivalence separately —
including the one bug this found in review, where a transcript caught mid-append had its resume
offset put past the half-written line, silently losing that record when it completed.

## Not in scope (#1377 lists them)

`readSessionSummary` re-reads a CHANGED file in full (10.5 s on 508 MB), `sessionTimeline` and
`rollupProjectCost` have no cache at all. Same medicine, separate PRs.
