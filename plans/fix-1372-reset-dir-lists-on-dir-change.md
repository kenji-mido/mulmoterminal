# The launcher keeps the previous directory's rows while the new ones load (#1372)

Change the directory in an empty cell and the resume list, the worktree rows and the script chips
under it go on showing what the PREVIOUS directory had, until the new answers arrive. That is not a
flicker: the field is debounced 300ms before anything is even asked for, and each of the three then
costs a round trip (`/api/sessions` walks the transcripts, `/api/worktrees` shells out to git). For
that whole window the form names one directory and offers another one's sessions — and clicking a
row resumes exactly the session it says it will, which is why this is a wrong-session bug rather
than a cosmetic one.

`useDirList` only ever writes on the way IN: the value is replaced when a response lands. Nothing
happens at the moment the directory changes. The tool-group switches beside them already do the
right thing — `useMcpToolGroups.forget()` drops them on the field change and `load()` clears before
the fetch — and the reason given there ("rows left on screen during the reload would be the
PREVIOUS directory's positions under the new directory's name") is the same reason here.

The second half is that an empty section and a section that has not loaded look identical: every
one of them is `v-if="…length"`. So even after the reset, the form says "this directory has no
sessions" for the length of the fetch, which is its own way of being wrong.

## Fix

**`src/composables/useDirLists.ts`** — give the shared loader the two things it lacks:

- `loading`, true from the moment the directory changes until that directory's list has landed —
  the debounce included, since that is most of the wait.
- `forget()`, which bumps the request token (an answer already in flight belongs to the directory
  being left), empties the value and marks it loading.

`load()` also empties before it fetches, so the guarantee does not depend on the caller having gone
through `forget()` first: a preset chip loads immediately without the watch (`fillDir`), and the
worktree list is re-read after a removal.

Only the newest request clears `loading` — a superseded one leaves the flag to the request that
replaced it, the same rule the value already follows.

**`src/components/CellLaunchForm.vue`** — `forgetForDir()` beside the existing `loadForDir()`, both
called from the same places: the watch drops all four (the three lists plus the MCP switches, which
already had this) and then schedules the debounced reload. One `Loading…` row stands where the
sections are while any of the three is still in flight.

One placeholder rather than three: after the reset there is nothing clickable to mislabel, so the
row's job is only to say why the space is empty — and three separate skeletons would have to invent
headings for sections that may not exist here at all (a directory that is not a git repo has no
worktree section).

## Scope

Confirmed with the requester: resume history, worktrees, script chips. The MCP tool-group switches
keep the behaviour they have (dropped immediately, no loading row).

## Tests

`test/src/composables/useDirLists.spec.ts`

- `forget()` empties the rows and marks the list loading
- an answer already in flight after `forget()` never lands
- `load()` empties before it fetches, and clears loading when the answer arrives
- `load(null)` does not leave the list loading
- a superseded answer does not clear the flag the newer request owns

`test/src/components/CellLaunchForm.spec.ts`

- changing the dir prop drops the resume rows and the worktree rows in the same tick, and shows the
  loading row — i.e. before the debounce has even elapsed
- once the new directory's answers land, the loading row goes and the new rows are there

## Not in scope

The launch button stays live while the lists load. The "a worktree is in use" guard reads the
worktree list, so during the wait it cannot warn — but it never could (before this it was reading
the wrong directory's list, which is worse), and the server refuses the spawn regardless
(`server/session/worktree-session-limit.ts`). Blocking Enter for the length of a fetch would be a
worse trade than the warning arriving a moment late.
