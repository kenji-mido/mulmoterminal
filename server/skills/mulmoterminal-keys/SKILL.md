---
name: mulmoterminal-keys
description: Bind keyboard shortcuts and fix keyboard/clipboard behaviour in MulmoTerminal. Writes `keymap`, `copyOnSelect` and `terminalSubmit` in `~/.mulmoterminal/config.json` — none of which can be set from Settings (its Keyboard shortcuts section only lists what is bound). Covers zooming a cell, jumping to whichever agent is waiting for you, opening and closing terminals, copy/paste, sending raw bytes to the terminal so a key the shell understands can be reached from a key your keyboard has (Cmd+Right for end-of-line), copying by selecting with no key pressed, and the Enter-vs-newline binding. Use when the user wants a shortcut or hotkey, wants to switch cells or reach a waiting agent without the mouse, wants selecting text to copy it, or reports that Shift+Enter submits their prompt instead of adding a line, that Enter drops to a new line instead of sending, that Ctrl+C stopped interrupting, or that a shortcut does nothing.
---

# Keyboard, shortcuts and clipboard

All three settings live in **`~/.mulmoterminal/config.json`**, and each write is a **partial
`POST /api/config` merge** — write only the key you are changing, so the user's other settings
survive.

Settings has a **Keyboard shortcuts** section, but it is **read-only** — it lists every action and
its current binding. Point the user at it after writing, as the check.

## `keymap` — shortcuts

**There are no defaults.** With no `keymap`, nothing is bound and no key is intercepted. Every
binding you add is a key the program inside the terminal (Claude Code, `vim`, `less`, the shell)
**stops receiving**. So ask before binding, and never add one the user did not request.

```json
{ "keymap": { "zoom-next": "PageDown", "zoom-prev": "PageUp" } }
```

| Action | What it does | Needs a zoomed cell |
|---|---|---|
| `zoom-toggle` | Enlarge / collapse — the only action that does; it enlarges whichever terminal the cursor is in | no |
| `zoom-next` / `zoom-prev` | Move the enlargement along the on-screen order | **yes** |
| `next-attention` | Go to the next terminal awaiting input, then finished-unreviewed, then idle — skipping cells mid-turn. Never enlarges or collapses | no |
| `terminal-new` | Add a terminal at the end (the toolbar's `＋`) | no |
| `terminal-new-adjacent` | Add one right after the current terminal, inheriting its cwd | **yes** |
| `terminal-close` | Close the current terminal | **yes** |
| `copy` | Copy the terminal's selection. Acts **only** when something is selected, so `Ctrl+C` stays usable as interrupt — with no selection the key reaches the program untouched | no |
| `paste` | Paste into the terminal | no |

**Always bind `zoom-toggle` or `next-attention`.** Everything marked "yes" needs something already
enlarged, so a keymap without one of those two can't be used without a mouse click first. Offer
`next-attention` to anyone running several agents — it is the "take me to whoever called" key.

### Starter sets — offer one of these rather than inventing keys

Each is checked against the traps below. The guide documents them at
[Configuration → Keyboard shortcuts](https://receptron.github.io/mulmoterminal/guide/en/config.html#keymap).

| Set | Keys | Suits |
|---|---|---|
| Minimal | `zoom-toggle: F8`, `next-attention: F9` | Anyone starting out — the two that open the feature up |
| Arrows | `Alt+ArrowUp/Left/Right/Down` | **The safe cross-platform default; the only one to offer a Mac user unprompted** |
| tmux-flavoured | `Alt+z / n / p / a / c / x` | tmux muscle memory — but **not** on macOS |
| iTerm2-flavoured | `Cmd+Enter`, `Cmd+[` / `]`, `Cmd+d` | Mac users who think in iTerm2 panes |

### Syntax, and what cannot be bound

`Modifier+Modifier+Key`. Modifiers: `Shift` / `Ctrl` (`Control`) / `Alt` (`Option`) / `Cmd`
(`Command`, `Meta`), case-insensitive. The key is matched against the browser's
`KeyboardEvent.key` — `PageDown`, `Home`, `ArrowUp`, `a` — and is **case-sensitive for letters**.

- **A malformed binding stops the server from starting**, naming the entry. Validate before writing:
  a stray `+`, a lone `Shift`, or an unknown modifier costs the user the whole app until they fix
  the file. Never guess a spelling — if unsure, ask them to press the key and read it off the
  devtools console (`addEventListener("keydown", e => console.log(e.key), true)`).
- **Modifiers match exactly.** Binding `PageDown` leaves `Shift+PageDown` with the terminal, which
  is how xterm's scrollback keeps working. Say this when proposing `PageUp`/`PageDown`.
- **No `F1`–`F12` on a Mac.** macOS delivers no keydown for them by default (they are media keys),
  so the binding looks broken for reasons the user cannot see. If they insist: `Fn`+the key, or
  System Settings → Keyboard → Keyboard Shortcuts → Function Keys.
- **No `Option`+letter on a Mac** — `KeyboardEvent.key` reports the composed character, not the
  letter, so it never matches. `Option`+a non-printing key (`Alt+ArrowDown`) is fine.
- **Never `Cmd`/`Ctrl` + `W` / `T` / `N`** — the browser reserves them; the binding silently does
  nothing.
- Two actions on one keystroke only fires the first. The startup check warns; don't write one.
- **`terminal-close` ends the session with no confirmation.** Only bind it if asked, and suggest a
  combination they won't hit by accident.

### `keymap.send` — raw bytes to the terminal

The actions above drive MulmoTerminal. `send` does the opposite: it puts **bytes straight into the
terminal**, so a key the shell or agent already understands can be reached from a key the keyboard
has. The motivating request was `Cmd+Right` for end-of-line on a Mac.

```json
{
  "keymap": {
    "send": [
      { "key": "Cmd+ArrowRight", "bytes": "\u0005" },
      { "key": "Cmd+ArrowLeft", "bytes": "\u0001" }
    ]
  }
}
```

A **list**, unlike the actions, because each entry carries its own payload. Control characters are
written the way JSON writes them (`\uXXXX`) and are **not** re-interpreted — the value reaches the
program exactly as written.

| Want | `bytes` | Is |
|---|---|---|
| Start / end of line | `\u0001` / `\u0005` | `Ctrl+A` / `Ctrl+E` |
| Back / forward one word | `\u001bb` / `\u001bf` | `Alt+B` / `Alt+F` |
| Delete to end of line | `\u000b` | `Ctrl+K` |
| Escape | `\u001b` | `Esc` |

- **An action beats a `send` on the same keystroke, always.** They are decided in different places
  and the action is claimed first, so the `send` silently never fires. The server warns at startup.
- **Empty `"bytes"` is refused** and stops the server: it would take the key from the terminal and
  put nothing back.

### After writing a keymap

The browser reads it **on page load — reload the tab.** A hand-edit made while the server is running
also needs a server restart before it reaches the page. Then check Settings → Keyboard shortcuts.

## `copyOnSelect` — copy just by selecting

For the PuTTY / iTerm2 behaviour (`copyOnSelect` in Windows Terminal): a mouse selection reaches the
clipboard **without pressing anything**. Off unless written.

```json
{ "copyOnSelect": true }
```

- **Only write it if asked.** It changes the clipboard when the user may have meant only to
  highlight something while reading, which is why it ships off.
- **Not** a replacement for the `copy` action, and they coexist — someone who selects with the
  keyboard still wants `copy` bound.
- **Over plain `http://` the browser gives the page no clipboard access at all** (the API is
  `https://`- and `localhost`-only). There is a fallback, but it needs the terminal to still hold
  keyboard focus. If the user reaches MulmoTerminal at `http://<ip>:PORT` and says dragging doesn't
  copy, **check this before the setting**.
- Whitespace-only selections, and a repeat of the last copied text, are deliberately **not** copied
  so an accidental drag doesn't destroy the clipboard. Say so if they report "it didn't copy".
- Read on page load: **reload the tab**.

## `terminalSubmit` — Enter vs. newline

Reach for this when the user says **"Shift+Enter submits my prompt instead of adding a line"** (or
equivalently, "a bare Enter drops to a new line instead of sending"). That is the tell-tale sign
their Claude Code is on the reversed binding, and it also makes the phone remote view's *send*
button type the text without submitting it.

```jsonc
{ "terminalSubmit": "cr" }      // default: Enter submits, Shift+Enter makes a newline
{ "terminalSubmit": "esc-cr" }  // reversed: Enter submits with ESC+CR, Shift+Enter makes a newline
```

- **Do not set this speculatively.** `cr` is correct for almost everyone. Only write `esc-cr` after
  the user confirms the symptom — setting it wrongly breaks Enter the other way.
- The *meaning* is identical in both modes (Enter submits, Shift/Option+Enter makes a newline); only
  which bytes carry it differs, because that is what their Claude Code was rebound to.
- **Claude sessions only.** A shell, codex, or command cell always submits with a plain `\r` even in
  `esc-cr`, so a reversed setting never rewrites a shell's Enter. Say so if asked.
- An invalid value falls back to `cr`, so a typo cannot leave Enter broken.
- Takes effect after a **tab reload** (keyboard) and a **server restart** (phone remote view).
