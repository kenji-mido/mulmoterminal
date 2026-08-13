# Keep the fold beside the transcript, not only in memory (#1386)

#1379 made the session list resume its fold instead of repeating it: an unchanged transcript is not
read at all, a grown one costs the bytes that arrived. That state lives in **one process's memory**,
so two things still pay full price:

- **a restart** — 2.1 s on the 2.1 GB project here, all of it one 461 MB file with no `ai-title`
  anywhere, read end to end to establish that it has none;
- **every other process** — eight mulmoterminals run against the same `~/.claude/projects` on this
  machine, and each one warms its own copy.

A sidecar fixes both: write what was folded, and the byte the fold stopped at, to a small JSON file.
The next process to want it reads a few KB instead of a few hundred MB.

## Which files get one

Transcripts here: 9,883 files, 9.6 GB, **median 93 KB** — the big ones are what matter.

| threshold | files | share of all transcript bytes |
| --- | --- | --- |
| >10 MB | 82 | **82%** |
| >50 MB | 32 | 70% |
| >100 MB | 18 | 59% |
| >300 MB | 10 | 43% |

**10 MB.** 82 files of a few KB each is nothing to keep, and it covers 82% of the bytes. Below that
a fold costs single-digit milliseconds, which is not worth a file — the in-memory cache already
covers it.

## Where, and what is in it

`~/.mulmoterminal/transcript-index/<kind>/<project-dir>/<session-id>.json` — the same home the
activity state and the background-session list already use. **Not** `~/.claude/projects`: that is
Claude Code's directory, and its own `cleanupPeriodDays` sweep runs there.

```json
{ "v": 1, "size": 532676421, "mtimeMs": 1785801386182, "head": "9f2a…", "scannedTo": 532676421,
  "value": { "aiTitle": "…", "lastPrompt": "…", "firstUserMsg": "…" } }
```

- `v` — bump when the fold's MEANING changes. A stale sidecar is not a stale cache; it is a wrong
  answer that survives restarts, so the version is checked before anything else.
- `size` / `mtimeMs` — same freshness rule as `createFileCache`: grown → resume from `scannedTo`,
  shorter → rebuild, same size + different mtime → rebuild.
- `head` — a hash of the first 256 bytes. The (mtime, size) pair cannot tell "appended to" from
  "replaced by something longer", and unlike the in-memory cache this one can be **days old** when
  it is read, so the odds of meeting a replaced file are no longer negligible. A transcript's first
  record carries its session id and start time, so a different file almost never matches.
- `value` — guarded on read like any other untrusted input. A file that fails any check is silently
  rebuilt; there is no error path a user could act on.

Written tmp + rename, so a reader never sees half a file, and eight writers just mean the last one
wins — every version is self-consistent. Writes are serialized per path within a process.

## This PR

The machinery, plus the one reader that is already an incremental fold (`readSessionMeta`), so the
mechanism ships proven end to end before the harder readers move onto it. The remaining two steps
are in #1386: `rollupProjectCost` + `sessionTimeline` (both fold into state that serialises as-is,
and neither has any cache today), then `readSessionSummary` (whose scan keeps RAW records and needs
restructuring first).

## Tests

`test/server/session/transcript-sidecar.spec.ts`

- a written sidecar is read back, and resumes at the stored offset
- version mismatch, shorter file, same size with a different mtime, a different head, corrupt JSON,
  a value that fails its guard — each rebuilds rather than answering
- a file below the threshold is never written and never read
- rename is atomic: no partial file is ever visible, and no tmp file is left behind
- the path is derived from the transcript's basenames only (a crafted path cannot escape the root)

`test/server/session/session-meta-sidecar.spec.ts`

- a big transcript folded once is answered from the sidecar by a reader whose in-memory cache never
  saw it — proven by changing the transcript's tail while holding (size, mtime), so an answer that
  matches the ORIGINAL can only have come from disk
- appending to it resumes from the sidecar's offset rather than folding from zero
- a small transcript gets no sidecar file at all

## Measured

`readSessionMeta` over the 50 most recent transcripts of a real project, run twice in SEPARATE
processes — the second is what a restart, or the second mulmoterminal on this machine, actually
sees:

| project | transcripts | first process (no sidecar) | second process (sidecar on disk) |
| --- | --- | --- | --- |
| mulmoclaude2 | 20 files, 2,112 MB | 1,795 ms | **23 ms** |
| mulmoclaude3 | 50 files, 1,135 MB | 467 ms | **52 ms** |

mulmoclaude3 keeps more of its first-read cost because most of its 50 files are under the 10 MB
threshold and are answered from their two ends anyway — which is the trade the threshold is for.

The whole index for both projects is **24 files, 96 KB**.

## Not in scope

Orphan sidecars (the transcript deleted under them) are left for a follow-up: they are ~1 KB each
and only appear when a >10 MB transcript is removed. Noted on #1386 rather than swept here.
