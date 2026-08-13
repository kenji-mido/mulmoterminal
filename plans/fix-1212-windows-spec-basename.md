# fix #1212 — the fs doubles must read a Windows path as a Windows path

## The failure

Windows (daily) has been red on every run since #1189 landed (2026-07-31 17:16 UTC); the most
recent is [run 30690834441](https://github.com/receptron/mulmoterminal/actions/runs/30690834441)
on `mulmoterminal@4.0.0`. Eight assertions, on both 22.x and 24.x, in two files:

| file | failures | landed in |
| --- | --- | --- |
| `test/server/session/unplaced-sessions.spec.ts` | 6 | #1189 |
| `test/server/session/push-classification.spec.ts` | 2 | #1196 |

Linux and macOS are green, which is why both PRs merged clean.

## Root cause

Both specs mock `node:fs` and route on the file's basename, spelled `String(file).split("/").pop()`.
The registry builds those paths with `path.join(MULMOTERMINAL_HOME, "unplaced-sessions.json")`, so
on Windows the double receives `C:\Users\...\unplaced-sessions.json`. Splitting on `/` returns a
single element — the whole path — so the name never equals `"unplaced-sessions.json"`:

- `readFile` falls through to `""`, so every hydrator sees an empty log; and
- `loggedTo()` filters every append out, so the recorded writes read as `""`.

Which is precisely the reported shape — `expected '' to contain '1111…'`, `expected [] to deeply
equal [...]`, and `{ background: false, userScheduled: false }` where both were `true`.

The product code is correct. Only the doubles are POSIX-only.

## Fix

`split(/[/\\]/)` — the separator-agnostic idiom the repo already uses in
`src/composables/soundSettings.ts`, `server/infra/pty-env.ts`, `common/workComment.ts` and
`src/components/presets.ts`.

Deliberately **not** `path.basename`: it is correct at runtime but untestable on the machines that
run the suite, because on POSIX it leaves `\` alone. A fix whose Windows behaviour can only be
observed on Windows is how this bug reached `main` in the first place.

Deliberately **not** `endsWith`: `"unplaced-sessions.json"` ends with `"placed-sessions.json"`, so
a suffix match reads the two logs as one and every assertion about the placed log silently counts
the unplaced one too. `unplaced-sessions.spec.ts` already carries a comment saying exactly this.

## Steps

1. `test/support/mockFsPath.ts` — one exported `mockedFileName(file: unknown): string`. Both specs
   had the same bug for the same reason, so this is one helper, not two edits.
2. `test/support/mockFsPath.spec.ts` — feed it a `\`-separated path, a `/`-separated one, and a
   bare name, so the Windows case is asserted on every platform. Pin the `endsWith` trap directly:
   the two sessions logs must come back as different names.
3. Point both specs at the helper (three call sites: the two `readFile` doubles and `loggedTo`).
4. `tsconfig.test-server.json` — add `test/support/**/*.ts` to `include`. Helpers under
   `test/support/` are only type-checked today as a side effect of a spec importing them, so a
   spec that lives there is checked by nothing. Adding the glob closes that gap.

## Verification

The suite passing on macOS proves only that the change is not a regression — the bug is invisible
there by construction. The ground truth for this fix is:

- the helper spec, which asserts the Windows spelling on this machine, and
- a re-run of the real Windows job on the pushed branch, which is what actually failed.

Both are required before the PR is called done.
