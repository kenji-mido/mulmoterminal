---
name: mulmoterminal-header
description: Put your own action buttons and info chips in a MulmoTerminal session header — either everywhere (`buttons` / `chips` in `~/.mulmoterminal/config.json`, which has no Settings UI) or for one project (`<project>/.mulmoterminal.json`). Buttons run a shell command in a new cell, type text into the running agent (`/compact`), or open a URL, the file explorer, a diff/PR/wiki overlay, or a new terminal. Chips show live context — branch, context left, diff counts, the PR or issue being worked on. Use when the user wants to add, remove, reorder or hide header buttons or chips, wants a one-click build/test/deploy on a session, wants the header to show something it doesn't, or asks why a button is missing or does nothing. For colours and grid order use mulmoterminal-dirs; for keyboard shortcuts use mulmoterminal-keys.
---

# Header buttons and chips

A session header carries **buttons** (things you can do) and **chips** (things you can read). Both
are configured in two places and merged, and **the two merge by different rules** — that asymmetry
is the thing to get right, and it has no UI anywhere.

## Where to write it

| File | Applies to | Settings UI |
|---|---|---|
| `~/.mulmoterminal/config.json` → `buttons` / `chips` | every directory | **none** |
| `<project>/.mulmoterminal.json` → `buttons` / `chips` | that project | **none** |

Ask which the user means. "A button for `yarn build`" is usually per-project (the command only
exists there); "show me the branch everywhere" is global.

Global writes are a **partial `POST /api/config` merge** — send only `buttons` / `chips`. Per-project
writes go through your Write/Edit tool, and **writing the file is itself the live-reload signal**;
there is no filesystem watcher.

## How the two are merged — not the same rule

**Buttons merge by `id`.** Global buttons load first, then the project's: a project button with the
same `id` **replaces** the global one, a new `id` is **added**. The result sorts by `order` (lower
first, unset last), ties keeping insertion order. So a project can override one button without
restating the rest.

**Chips replace wholesale.** A project that sets `chips` **discards** the global list entirely; one
that omits the key inherits it. There is no per-chip override.

**`null` (absent) and `[]` are different.**

- `buttons` absent at *both* levels → the built-in starter set below.
- `buttons: []` → **no buttons at all**, not "the defaults". And setting it globally means a project
  that configures nothing also gets nothing, since the empty list is what it inherits.
- `chips` absent → the client's default chip set. `chips: []` → every chip hidden.

**Omit the key you were not asked about.** Writing `chips: []` to a user who only wanted a button
silently strips their header.

## The built-in buttons

With `buttons` unset anywhere, these show. Each is an ordinary config button, so the way to trim or
reorder them is to **list the ones you want** — there is no "remove" syntax.

| id | Label | What it does |
|---|---|---|
| `pick-file` | Insert a file path | OS file dialog; inserts the chosen path(s) into the session |
| `pr` | Open this branch's PR | Git repos only; **hidden when the branch has no open PR** |

Dropping just one means writing the other.

### The four that are no longer buttons

Reveal in the file manager, the in-app file explorer, a new terminal here, and Open on GitHub used
to be default buttons. They are now items in the **path menu** — click the directory path on a
session's terminal header row and they are all there, with Issues and Pull requests as well.

They moved because every one of them answered "do something with the directory this cell is in",
which is the question the path itself asks; `reveal` was the path's own click outright. Four
permanent icons in a tiled cell for four occasional navigations was the wrong trade.

Nothing about them changed as CONFIG. If a user wants any of them back as a button — one click
instead of two — list it and it works exactly as before:

```json
{ "id": "files", "icon": "folder_open", "label": "Browse files in the app", "run": "open", "open": { "files": "${dir}" } }
```

Say when you do that: they will then have it twice, once as their button and once in the path menu.
The menu is fixed and does not know what is on the toolbar.

## Propose only buttons that work here

Look at the directory before suggesting anything, and say what you skipped and why:

- `package.json` → offer only scripts that exist (`yarn build`, `yarn test`, …).
- `git rev-parse --is-inside-work-tree` → gate git buttons with `"when": "isGitRepo"`.
- `git remote get-url origin` → without a remote, `${repo}` resolves to nothing and a GitHub button
  is dead. Don't offer it.

Ones that work anywhere: `/compact` (`run: "input"`, `when: "agent == claude"`), the file explorer,
the OS reveal.

## Buttons — schema

An array, ≤ 32 entries:

```json
{ "id": "build", "icon": "build", "label": "Build", "run": "shell", "cmd": "yarn build", "when": "isGitRepo", "order": 10 }
```

- `id` (**required**, unique — it is also the merge key), `label` (**required**),
  `run` (**required**): `"shell"` / `"input"` / `"open"`.
- `icon` — a [Material Symbols](https://fonts.google.com/icons) name (`build`, `folder`,
  `bar_chart`). Prefer it. An `emoji` field exists and wins when both are set, but this project
  ships icons only.
- Payload, by `run`:
  - `"shell"` → `cmd` — runs in a command cell. Resolved **server-side by id** at exec time; the
    command is never sent to the browser.
  - `"input"` → `text` — typed into the running Claude/Codex, e.g. `"/compact"`.
  - `"open"` → `open`, with at least one of:
    `url` (http/https only) · `reveal` (dir → OS file manager) · `files` (dir → in-app explorer) ·
    `view` (`"diff"` / `"prs"` / `"wiki"` / `"collections"` / `"accounting"`) ·
    `terminal` (dir → a new cell running `$SHELL`) · `pr: true` (this branch's PR; the button hides
    when there is none) · `pickFile: true` (OS file dialog → insert the path).
- `when` — visibility condition (below). `order` — sort key, lower first, unset last.

## Chips — schema

An array, ≤ 16 entries. Each is either a built-in id or a custom read-only chip.

Built-ins, shown in the order you list them (omit one to hide it):
`"dir"` `"git"` `"work"` `"ctx"` `"usage"` `"status"` `"diff"` `"tools"`.

`work` is the one people miss: it names the PR or issue the cell is on. It is in the client's
default set, so a header nobody has configured shows it — but the moment you write `chips` at all,
**you must list it or it disappears**, and that reads as a feature breaking rather than a chip
being deselected.

Custom:

```json
{ "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }
```

Custom chips are **display only** — no click behaviour. Something clickable is a button.

## `${var}` substitution

Available in `cmd`, `text`, `open.*`, and a custom chip's `text`:

`${dir}` `${dirName}` `${branch}` `${repo}` `${model}` `${agent}` `${session}` `${remoteUrl}`
`${dirty}` `${ahead}` `${behind}` `${task}`

## `when` — the visibility mini-language

Atoms: `isGitRepo`, `!isGitRepo`, `key == value`, `key != value` (keys are the `${var}` names,
written bare). Combine with `&&` (binds tighter) and `||`. **No parentheses.** Empty or absent →
always shown.

```text
agent == claude && isGitRepo
```

`key !=` with the right-hand side left empty tests "resolves to something" — `"when": "repo != "`
is what a GitHub button needs so it never renders as a bare `https://github.com/`. Use that rather
than `isGitRepo`: a git repo with no remote, or one whose remote is not GitHub, is still a git repo.

## After writing

- **Per-project**: live. The header re-resolves; nothing to reload.
- **Global**: a partial `POST /api/config` merge takes effect for sessions as they re-resolve their
  header; a hand-edit of the file while the server is running needs a restart.

Then check the real header. A button that doesn't appear is nearly always `when` (a non-git
directory, an agent mismatch) or a `pr` button on a branch with no PR — both are working as
designed, and both look like a broken config.

## Example — pinning the defaults, globally

The default set is short, so writing it out is the whole of it — this is the complete current
default configuration, useful as the starting point for adding to or trimming:

```json
{
  "buttons": [
    { "id": "pick-file", "icon": "attach_file", "label": "Insert a file path", "run": "open", "open": { "pickFile": true } },
    { "id": "pr", "icon": "merge", "label": "Open this branch's PR", "run": "open", "when": "isGitRepo", "open": { "pr": true } }
  ]
}
```

A project can then add its own build button without restating any of these — different `id`, so it
is merged in, not replacing them.
