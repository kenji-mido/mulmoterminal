---
title: Basics
layout: default
parent: English
nav_order: 1
description: Running several AI coding agents (Claude Code, Codex) in parallel from a browser terminal — how to read a cell, what the status colours mean, and the cockpit roster. Vibe coding with the terminal as your hub.
---

# Basics — what you can do in the grid today
{: .no_toc }

- TOC
{:toc}

---

## The grid is "a board of agents"

The grid view is the screen for **supervising many AI coding agents (Claude Code, Codex) in
parallel**. Vibe coding with one agent needs one terminal; going **parallel** is what makes this
screen necessary. Each cell is one independent
agent (or terminal). While one is thinking, you push another cell forward and pick up **only the ones that
call you** — **amber** for a cell awaiting input or a permission, a **blue ring** for a turn that finished and
awaits review — the goal is to run many agents solo instead of babysitting them all.

MulmoTerminal has two display modes; switch between them with the **chat / grid** icons in the top toolbar.

- **Single view** — the screen for **focusing** on one agent (conversation on the left, a GUI panel on the right for diagrams, forms, images, documents, video, and more). Its URL is **`/chat`**.
- **Grid view** — the screen for **supervising many agents at once**, tiled side by side. This is the star of this guide, and **what the app opens on**: `http://localhost:34567/` lands here (the URL settles on `/terminals`).

Bookmark `/chat` if you would rather start on the single view.

**The top toolbar differs between the two**, because the two screens are for different things:

| | Grid | Single view |
|---|---|---|
| Running agents | New terminal, cell ordering, the status tally, **Pull requests**, **Worklog** | — |
| Content | — | **Collections**, **Accounting**, **Wiki**, your pinned favourites |
| Switching | chat / grid icons | chat / grid icons |

A full-screen surface (Collections, Wiki, PRs, Accounting, Files) now **returns to the view you opened it from** when you close it.

![Single view — focus on one agent](../images/single-view.png)

## Launching an agent or a shell (launcher form)

Empty cells in the grid show a **launcher form**. This is where you choose **what** to run and **where**.

![The launcher form in an empty cell](../images/grid-launch-form.png)

| Part | Role |
|---|---|
| **Claude / Codex / Antigravity / Shell** toggle | Choose what runs in this cell — an **agent**, or **Shell**: your OS default shell (`$SHELL`), with nothing to install and nothing to configure |
| **WORKING DIRECTORY** | Enter the working directory (the play button launches it). Frequently used directories are offered as clickable *cwd preset* **chips** that fill the field (the chip's play button launches right away) |
| **Model picker** (when Claude is selected) | Pick the backend / model for this session only (→ [providers](providers.html)) |
| **OR ISOLATE IN A WORKTREE** | In a git repo, enter a task name and hit **New worktree** to create an isolated worktree and launch there |
| **OR LAUNCH** | Start a configured **launch command** (`codex`, `htop`, anything) as a persistent terminal |

**Shell** takes the same working directory and the same play button as an agent. A shell has no
model, no MCP registration and no worktree, so those rows disappear while it is picked — and the
cell it opens is a persistent terminal (running / exited), not an agent session.

![The same form with Shell picked — only the working directory is left](../images/grid-launch-form-shell.png)

## Reading a cell — "what each agent is doing and where"

The header of a running cell has two rows. Together they capture that agent's **status, location, and current work**.

![A running cell (two-row header)](../images/grid-one-cell.png)

- **Row 1 (info):** status dot, directory, git chip (`⎇ branch ●changes`), **model / context size**,
  what that agent is **doing right now**, and expand / close.
- **Row 2 (controls):** connection status, **Insert a file path**, **Reveal in the file manager** (the default
  buttons — [replaceable in config](config.html#header)), GitHub, and **Activity timeline** (tool-call history).

> **Status shows up as color.** A bluish border means **working** (thinking), **amber means awaiting input or a
> permission** (Needs input), a **blue ring + glow means a finished, unreviewed turn** (Done — review; a green dot
> in the thumbnails), and neutral means idle. A sound plays too, so you know you've been **called without watching
> the screen**. This is the heart of the grid.

## Tiling many, pages, and reordering

- Add cells with **New terminal** in the toolbar. Up to **9 cells** per page; overflow moves to the next page (tab).
- The ordering button cycles three modes — **auto** (attention-first: cells needing you float up), **manual** (arrange them yourself with each cell's move buttons), and **priority** (the order each project declares as `orderPriority` in its `.mulmoterminal.json`, see [Configuration](config.html#order-priority)).

![Agents running in parallel](../images/grid-2x2.png)

## Zooming into one (the cockpit roster)

Hit a cell's **Expand** (expand) to show that agent large — and next to it, the **cockpit roster**: a text list
with one row per session (the default). Each row carries the directory, an **AI summary**, the last prompt,
the latest reply, a status word (running / planning / done / idle …), and the branch's **PR phase** badge
(draft / CI fail / changes / ready / merged …). **Click a row to swap** which terminal is enlarged; the ⋮ menu
reorders rows. You stay zoomed in while still reading, in plain text, what everyone else is doing and how far
along it is — this is the main screen for running many agents.

![The cockpit roster — a summary list of every session on the left, one agent enlarged on the right](../images/cockpit-roster.png)

The **Show list roster / Show thumbnail strip** button in the top-right corner switches between the roster and the **filmstrip** (a thumbnail
strip; click a thumbnail's header margin to switch cells). **Restore** returns to the grid.

![Zoom (filmstrip view)](../images/grid-zoom.png)

### Switching the enlarged terminal from the keyboard {#keyboard-zoom-switch}

You can bind keys that move the enlargement to the next / previous terminal — the keyboard equivalent of
clicking a roster row, so you can walk the whole board without reaching for the mouse. The order followed is
the one on screen, so it respects the roster's current sort (including attention-first ordering).

{: .important }
> **Nothing is bound out of the box.** Any key this claims is a key the program inside the terminal stops
> receiving, so that trade is yours to make: add a `keymap` to `~/.mulmoterminal/config.json` and the
> shortcuts turn on. With no `keymap`, they stay off entirely.

```json
{
  "keymap": {
    "zoom-next": "PageDown",
    "zoom-prev": "PageUp"
  }
}
```

→ **Binding syntax, the full action list, and which combinations can never be bound:
[Configuration → Keyboard shortcuts](config.html#keymap).**

Two behaviours worth knowing:

- **They only work while zoomed.** In the normal grid nothing happens, because an un-zoomed grid has no
  "current terminal" — the enlarged cell *is* the selection.
- **They stop at both ends** rather than wrapping. With only two terminals this means roughly half of your
  presses do nothing: previous-on-the-first and next-on-the-last are deliberately no-ops.

Collapsing with **Restore** returns you to the page holding the terminal you were just looking at, not the page you
originally zoomed in from.

{: .warning }
> **A bound key is taken away from the program inside the terminal.** Bind `PageDown` and, while zoomed, it
> no longer reaches `less`, `vim`, or Claude Code's own paging. Modifiers are matched exactly, so binding the
> bare key leaves **`Shift`+`Page Up` / `Shift`+`Page Down`** alone — they still scroll the terminal's
> scrollback, which is the usual way out. An active IME conversion always passes through, so a candidate list
> paging with Page Down keeps working.

On a Mac laptop keyboard there are no dedicated Page Up / Page Down keys; use **`Fn`+`↑`** and **`Fn`+`↓`**.

## Mixing Claude, Codex and Antigravity {#claude-and-codex}

In the same grid, you can launch **Claude**, **Codex** or **Antigravity** (`agy`) per cell — or **Shell**, when
you only want a terminal. The agents share the same terminal experience, persistence, GUI panel, and visibility
machinery. Use each for its strengths, or throw the same task at several and compare.

Antigravity needs `agy` on your `PATH`. `ANTIGRAVITY_BIN` / `ANTIGRAVITY_MODEL` / `ANTIGRAVITY_HOME` override the
binary, the model, and where it keeps conversations. One difference worth knowing: its GUI-panel registration is
written **per directory** (`.agents/mcp_config.json`, kept out of your `git status`), not per session, because
that is the only project-scoped file `agy` reads.

---

Next: [Scenarios — usage by scenario](scenarios.html)
