# feat(settings): say what a skill button does, and let it be cancelled (#1564)

## Problem

A Settings skill button ("Configure notifications…") is an icon and a label. Pressing it closes
Settings, spawns an agent session in a new grid cell, and **auto-sends the seed**, so a turn is
already running before the person who pressed it knows a session started.

Nothing on screen says that will happen, and nothing says how to undo it. Stopping means pressing
Esc (which interrupts the turn — and means something else entirely in a worktree close dialog, so
"Esc goes back" is a wrong lesson to learn) and then closing the cell. The report is someone who
decided they did not need the setting after all and could not find the way back.

## Decision

Both halves of what was asked for: **say it before, and make it cancellable.**

1. A one-line hint under every skill button, so the button no longer stands alone.
2. A confirmation on press that names what will happen and how to stop it, with **Cancel / Start**.

Not doing: a "don't show this again" checkbox (starting a session is worth confirming every time,
and it would need its own way back), and no banner on the started cell (the dialog says it before
the cell exists, which is where the question is actually asked).

## Where the dialog lives, and why it is not in the button

**`SettingsModal` owns it**, not `SkillLaunchButton` and not the shell:

- **Escape must mean one thing at a time.** `useModalKeyboard` binds Escape on `document`. A second
  dialog with its own binding would close the confirm *and* the whole Settings modal on one press.
  With the state in `SettingsModal`, its existing `onClose` becomes "close the confirm if one is
  open, else close Settings" — one listener, layered correctly.
- **Tab has to stay inside the confirm.** `useModalKeyboard` takes the trapped element as a
  `{ value }`, so a `computed` that returns the confirm element while it is open and the dialog
  otherwise moves the trap without a second listener.
- **Settings stays open behind it.** Today `launchSkill` calls `closeSettings()` first, so
  cancelling would have nothing to return to. The `launch-skill` event now fires only on confirm,
  so the shell's behaviour is unchanged and `GridView` needs no edit.

Sections keep emitting `launch-skill` exactly as before; `SettingsModal` intercepts instead of
forwarding. Nothing outside this file learns about the confirmation.

## What it says

The agent is named from `launchAgent` (the picker's saved choice), not assumed to be claude — the
seed is rewritten server-side for codex, and a dialog that says "claude" while codex starts is
worse than saying nothing.

- **Title** — asks whether to let the agent configure this.
- **What happens** — one new terminal opens; the agent asks questions and edits your config file.
- **How to stop** — close that cell (named as the cell's close button, not as a glyph — see the
  no-emojis rule); Settings can be reopened from the toolbar at any time.
- **Buttons** — Cancel / Start, Cancel first so the safe one is not under the pointer.

All of it goes through `src/i18n` in both bundles, like the rest of the modal (#1566).

## Tests

- pressing a skill button emits nothing yet, and shows the confirm
- Start emits `launch-skill` with that skill; Cancel emits nothing and leaves Settings open
- Escape closes the confirm and **not** the modal; a second Escape closes the modal
- the dialog names the agent the picker is set to, not a hard-coded claude
- every skill button in the modal goes through it (enumerated from what renders, not a list here)
