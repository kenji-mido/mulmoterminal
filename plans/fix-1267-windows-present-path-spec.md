# fix #1267 — the present-path spec must spell a session cwd the way the platform does

## The failure

`Windows (daily)` has been red on every run since #1226 landed (2026-08-01 16:58 UTC); the first is
[run 30709308166](https://github.com/receptron/mulmoterminal/actions/runs/30709308166) and the most
recent is [run 30724035812](https://github.com/receptron/mulmoterminal/actions/runs/30724035812).
Last green: [30702245163](https://github.com/receptron/mulmoterminal/actions/runs/30702245163).

One assertion, on both 22.x and 24.x, in `test/server/backends/presentPathRoot.spec.ts`:

```
FAIL  absolutizePresentPath > resolves a relative path against the session cwd
-   "path": "/repos/mulmoterminal/README.md",
+   "path": "D:\\repos\\mulmoterminal\\README.md",
```

Linux and macOS are green, which is why #1226 merged clean.

## Root cause

The spec's fixture is `const CWD = "/repos/mulmoterminal"` and the expectation is the template
`` `${CWD}/README.md` `` — a hardcoded POSIX join. `absolutizePresentPath` resolves with
`path.resolve(cwd, value)`, which on Windows both picks up the current drive and joins with `\`.

The product code is right: a session cwd is whatever the platform spells, and the two hops
downstream (the View's dispatch, the `/htmlfile` mount) receive that same native path. Every other
expectation in the file already goes through `path.resolve` — which is why only this one test
failed while the middleware tests covering the same rewrite passed.

## Fix

1. Resolve the fixtures (`CWD`, `WORKSPACE`, `DOT_CWD`) with `path.resolve`, the idiom already used
   for absolute fixtures in `test/server/config/cwd-presets.spec.ts` and
   `test/server/files/pathContainment.spec.ts`. A session cwd that is drive-relative on Windows is
   not a session cwd any server would report.
2. Build the expected value with `path.join(CWD, "docs", "design.md")` rather than string
   concatenation.

Deliberately **not** `path.resolve(CWD, value)` in the expectation: that is the exact call the
implementation makes, so it would assert nothing beyond "the function is itself". With `CWD` already
absolute, `path.join` is a separate function that reaches the same answer.

Scope is the spec alone. The Windows job runs the whole suite, and this was the only failure, so
there is no second site with the same POSIX-only spelling to sweep.

## Verification

macOS passing proves only that this is not a regression — the bug is invisible there by
construction. The ground truth is a `workflow_dispatch` of `Windows (daily)` at the fix branch,
which is the job that actually failed. Required before the PR is called done.
