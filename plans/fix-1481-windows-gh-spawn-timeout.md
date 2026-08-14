# fix #1481 — Windows CI: worktree-pr.spec.ts times out on the real `gh`

## The failure

`Windows (daily)` on main, [run 31055365939](https://github.com/receptron/mulmoterminal/actions/runs/31055365939)
(node 24.x), and before it [run 31041081619](https://github.com/receptron/mulmoterminal/actions/runs/31041081619):

```text
FAIL test/server/git/worktree-pr.spec.ts > push / PR actions >
  createOrOpenPR pushes, then reports no-forge for a remote on no forge it knows
Error: Test timed out in 30000ms.
Error: EPERM, Permission denied: ...\Temp\mt-pr-home-AgjGhf   ← rmDirRetrying, afterEach
```

## Where the time goes

Measured, not guessed — from the **passing 22.x job of the same commit**, which prints per-test
durations:

| test | duration |
| --- | --- |
| pushes the worktree branch to origin | 2150 ms |
| refuses to push when there is no origin remote | 1384 ms |
| refuses a path that isn't a managed worktree | 887 ms |
| **createOrOpenPR … reports no-forge** | **20858 ms** |

Every test in the file runs the same `beforeEach` (three temp dirs, `git init --bare`, `git init`,
config, commit) and the first one additionally creates a worktree, commits and pushes — the whole
of the failing test except its last line. So ~19 s belongs to `createOrOpenPR`'s tail:

- ~5 more `git` calls (`repoRoot`, `defaultBaseBranch`, `git remote get-url` twice)
- **two real `gh` spawns** — `gh pr create`, then `gh pr list` when that fails

A `git` spawn on that runner is ~100 ms (28 tests of `worktrees.spec.ts`, 10+ spawns each, in
32 s), so the extra git accounts for ~0.5 s of the 19 s. The rest is the two `gh` starts. `git.exe`
is warm — the suite spawns it hundreds of times; `gh.exe` is started exactly twice in the whole
suite and is read cold off a slow NTFS volume. On macOS the same two calls cost 154 ms measured
directly, which is why nothing but Windows ever saw this.

`worktree-pr.spec.ts` is the only spec in the suite that spawns a real `gh` — and it is the only
one that timed out.

The `EPERM` is downstream of the timeout, not a second defect: vitest abandons the test at 30 s
while its children are still alive with a cwd inside the temp dir, and Windows will not remove a
directory that is a live process's cwd. `rmDirRetrying`'s 10 retries span 5.5 s and lose to a
process that is still running. It cannot happen once the test does not time out, so nothing in
teardown is changed here — swallowing it would mask the next real hang.

## The fix

Stub `gh` in that spec; keep `git` real.

The test's own comment already says what it assumes: *"No CLI can make a request here"*. That was
an assumption about the machine, not an assertion — so state it, instead of relying on an ambient
`gh` erroring its way to the same answer at whatever cost the platform charges. `spawn-collect` is
mocked with a passthrough for `git` and a fixed failure for anything else, which is exactly the
`no-forge` precondition.

What the test still exercises for real: a real repo, a real managed worktree, a real
`git push -u origin`, the branch actually landing on the bare remote, and `repoForDir` reading a
real remote URL and finding no forge.

What already covers the `gh` argv and the create→list→fallback wiring: `worktree-pr-timeout.spec.ts`
(mocked `spawnCollect`) and `pr-finalize-body.spec.ts` (injected `Runner`).

## Verification

- locally: the file is green and the test drops to roughly its siblings' cost
- ground truth: `workflow_dispatch` the Windows workflow on this branch and read the test's
  duration out of the log — the claim is falsifiable there. If it stays ~20 s, the attribution
  above is wrong and the run says so.
