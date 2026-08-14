# fix #1623 — a new document's filename is 32 bits, and a collision overwrites

## The report

[#1623](https://github.com/receptron/mulmoterminal/issues/1623): `saveNewDoc`
composed `artifacts/documents/YYYY/MM/<prefix>-<8 hex>.md` and wrote it with a
plain `fs.promises.writeFile`. Two things compound:

- **32 bits**, shared by every document with the same prefix in the same month.
  `prefix` comes from the LLM's title and falls back to `document`, so a
  month's worth of untitled documents share one namespace.
- **No overwrite guard.** Unlike the collections store (`refuseOverwrite: true`,
  which turns a collision into a 409), this write replaces whatever is there and
  reports success. The older document is gone with no error anywhere.

Found while surveying both repos for the same class of bug as
receptron/mulmoclaude#2851; not observed in the wild.

## Root cause

The id width and the write mode were each chosen in isolation: an 8-char slice
"looks like enough" for a filename, and `writeFile` is the obvious call for
"write a new file". Neither is wrong alone; together they make silent data loss
the failure mode of a name collision.

MulmoClaude — the reference host for this backend — already answers both:
`buildArtifactPathRandom` (`server/utils/files/naming.ts`) uses `shortId()`,
16 hex = 64 bits. So this was also a divergence from the counterpart.

## The change

1. `server/backends/docPath.ts` — `newDocId()`, 16 hex characters (8 random
   bytes), the same shape MulmoClaude's `shortId()` gives a filename. The
   generator lives next to `buildDocPath` because they are the two halves of one
   filename.

   Straight `randomBytes(8)` rather than a slice of a UUID: the 13th character
   of a v4 is the version nibble, always `4`, so 16 characters taken from a
   UUID carry 60 random bits while reading as 64 (codex review on the PR). A
   test pins that no position is constant, so a future "just slice a UUID"
   rewrite has to notice.
2. `server/backends/markdown.ts` — `createDoc()` writes with `flag: "wx"`, which
   refuses an existing file, and re-rolls the id on `EEXIST` (5 attempts, then
   throws). `saveNewDoc` is now three lines over it.

64 bits alone would have made the collision unreachable in practice, but the
guard is what removes *overwriting* as a possible outcome — a filename can also
be taken by something this code did not generate (a hand-written document, a
restored backup), and no width protects against that.

`createDoc` takes the id generator as a parameter so the collision is testable;
`saveNewDoc` passes nothing.

## Tests

- `test/server/backends/createDoc.spec.ts` (new) — writes under the dated
  directory; a taken name re-rolls and **the older document keeps its content**;
  exhausting the attempts throws and still leaves the existing document intact;
  50 concurrent creates with one title get 50 distinct paths.
- `test/server/backends/docPath.spec.ts` — `newDocId` is 16 lowercase hex, 1000
  rolls are distinct, no position is a constant nibble, and the composed path
  passes `isDocPath`.
- `test/server/backends/openPath.spec.ts` — the shape assertion for
  `saveNewDoc` moves from `{8}` to `{16}`.
