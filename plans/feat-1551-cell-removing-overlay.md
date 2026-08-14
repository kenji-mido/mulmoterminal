# feat #1551 — a cell being removed should look like a cell being removed

## The gap #1550 left

#1550 made the removal button hold itself and read `Removing…`. That is a 12px label inside a
dialog. Meanwhile the **cell** — its header, its directory chip, its terminal — carries on looking
exactly like a live cell for the several seconds `git worktree remove` takes on a large repository.
So the whole screen still says "nothing happened", which is the complaint #1549 was about, one
layer out.

## What ships

**While `closeBusy === REMOVE_KEY`:**

1. **The whole cell fades**, header included, through the mechanism parked cells already use
   (`SUNK_CELL` = `opacity-40` on `.cell-inner`, which wraps every child — see `cellParked.ts`).
   One computed yields the class for **either** reason, because two opacity utilities on one
   element are settled by Tailwind's output order rather than by intent — the rule `SUNK_CELL`'s
   own comment sets.
2. **One spinner over the whole cell**, as a **sibling** of `.cell-inner` rather than a child: a
   busy indicator inside the layer it is dimming would be dimmed by it. `absolute inset-0` on the
   cell root therefore covers the header too, which the close-confirm overlay never did (that is
   why #1550 needed a re-entry guard on `close()`).
3. **The confirmation dialog is replaced, not faded.** Every one of its controls is already
   disabled during the removal, and a dialog of dead buttons at 40% is noise where a spinner is an
   answer. It comes **back** — with the failure — if the removal fails, which is the behaviour
   #1550 shipped and this must not lose.

Nothing else changes: the dismissal guards from #1550 (`cancelClose`, `close`, the disabled
controls) all stay, because they are what makes the confirmation return intact on a failure.

## Not in scope

The launcher's own `wt-del` row already shows its spinner in place (#1550) and is a row in a list,
not a cell — there is no cell to grey out. Left alone.

## Files

| file | |
|---|---|
| `src/components/cellParked.ts` | `SUNK_CELL` gains a second caller; comment says so |
| `src/components/TerminalCell.vue` | the dim computed, the busy overlay, the dialog's `v-if` |
| `test/src/components/TerminalCell.spec.ts` | the overlay appears and covers, the dialog returns with its error on failure |
