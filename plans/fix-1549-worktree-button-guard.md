# fix #1549 — a slow button that never says it is working gets pressed again

## What happens

`+ New worktree` in the launcher POSTs `/api/worktrees/create` and changes **nothing** on screen
while `git worktree add` checks the tree out. On the reporter's ~33,000-file monorepo that is ~6
seconds of a form identical to the one before the click, with the button still enabled — because
its only `disabled` test is "is the task field empty", and the field is cleared **after** the
response lands. Three presses produced `agent/<slug>`, `agent/<slug>-2`, `agent/<slug>-3`:
`uniqueBranch` takes the free suffix, so every press succeeds.

The same line hides the failure. `if (!res.ok) return;` plus `catch {}` means a 500 shows nothing
at all — the reporter's real cause (`git worktree add … main` with no local `main`, exit 255) was
only found by reading the `dist` bundle.

The neighbouring controls in this very form already have the rule: `pickPaths` refuses a second
call while one is in flight (#1527) and returns the server's sentence (#1447); the `/prs` issue row
holds itself with `starting` for exactly this reason (#1219). Worktree creation is the entry point
that got neither.

## The rule, and everywhere it was missing

**A click that shells out must hold itself until it settles, and must say why it failed.** Three
handlers in the launcher and one in the running cell were missing it — all of them slow (`git
worktree add` / `remove`, up to four `claude mcp add` calls), all of them silent:

| where | what a second click did |
|---|---|
| `CellLaunchForm` `+ New worktree` | **a second worktree** for the same task (#1549) |
| `CellLaunchForm` worktree row | a second `emit("start")` — the launcher awaits `syncMcpGroupsInto` first |
| `CellLaunchForm` delete (`wt-del`) | a second `worktree remove` at the same path |
| `TerminalCell` `Discard & remove` | terminates the pty twice, removes twice |

## What ships

**`src/composables/useBusyAction.ts` (new)** — the rule in one place. `busy` holds the KEY of the
action in flight (so the pressed control can spin while the others are merely disabled) and `run`
drops any call arriving while it is set. Exclusive across keys, not per key: these all shell out to
git in one repository, and `useIssueStart` / `useSessionStop` already hold themselves the same way.

**`CellLaunchForm.vue`**

- all three handlers go through `runWorktreeAction`; `wt-start` and `wt-del` are `disabled` while
  any of them runs, and the acting control shows `progress_activity` (the spinner the
  `cell-dir-loading` row already uses) with the label changing to `Creating…`
- `wt-error` under the section carries the server's own sentence — `{ error }` from create,
  `{ ok:false, reason }` from remove — the treatment `cell-dir-pick-error` got in #1447
- `wt-start` gets `enabled:hover:` / `disabled:cursor-not-allowed disabled:opacity-40`, so an
  empty task name no longer leaves a button that looks pressable and does nothing
- the delete confirm is not raised at all while another action runs, or the user would answer a
  dialog for work that is then dropped

**`TerminalCell.vue`** — `Discard & remove` runs through the same composable; the button reads
`Removing…` and both it and the retry button are held.

**`cellChromeRules.ts`** — `worktreeRequestFailure(body, status)` reads the route's two refusal
shapes; `dirty` and `not-managed` join the reason table (remove answers them; nothing rendered
them before).

## Deliberately not done

The route's 500 body is `could not create the worktree (is this a git repo?)` whatever went
wrong — misleading in the reporter's case, where it **was** a repo and the base branch was
missing. Surfacing git's own stderr means changing `git()` (which drains and discards stderr on
purpose) and `createWorktree`'s `null` return, which every caller and a dozen specs read. Out of
scope here; the UI now shows whatever the server says, so improving that message is a
self-contained follow-up.

Server-side de-duplication of concurrent creates is also left alone: `agent/<task>` and
`agent/<task>-2` from two deliberate creates is the documented behaviour, pinned by a spec.

## Files

| file | |
|---|---|
| `src/composables/useBusyAction.ts` (new) | one-at-a-time guard, keyed |
| `src/components/CellLaunchForm.vue` | three handlers guarded, spinner, `wt-error`, disabled styling |
| `src/components/TerminalCell.vue` | `removeAndClose` guarded + `Removing…` |
| `src/components/cellChromeRules.ts` | `worktreeRequestFailure`, two more reasons |
| `test/src/composables/useBusyAction.spec.ts` (new) | second call dropped, released after a throw |
| `test/src/components/CellLaunchForm.spec.ts` | one POST per press, spinner, error text |
| `test/src/components/cellChromeRules.spec.ts` | the two refusal shapes |
