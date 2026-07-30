---
name: mulmoterminal-config
description: The way into configuring MulmoTerminal, and the way to find out how it is configured now. Use for a broad or unsure request — "configure MulmoTerminal", "set this up", "customize this", "what can I change?", first-run setup — and route to the skill that owns the area. Also answers "how is this set up right now?", "why isn't my setting working?", "did that take effect?" by reading the live config: the global `~/.mulmoterminal/config.json`, each project's `.mulmoterminal.json`, and what the app ACTUALLY parsed from them — including keys it dropped in validation, which is the difference between a setting you never made and one that silently never applied. When the request already names an area, go straight to that skill instead: mulmoterminal-dirs (colours, grid order, project names, font size), mulmoterminal-theme (your own colour scheme), mulmoterminal-header (buttons and chips), mulmoterminal-keys (shortcuts, copy-on-select, Enter behaviour), mulmoterminal-model (other models and backends), mulmoterminal-notify (sounds and push).
---

# Configuring MulmoTerminal — start here

This skill does two things: it **routes** to whichever skill owns what the user wants, and it
**reports** on how things are configured right now. Anything that writes a setting lives in a
sibling skill.

## Where settings live

| Place | What | Written by |
|---|---|---|
| Settings modal | Theme, font size, scroll speed, notification sounds, Push, PR repos, launch commands, phone quick commands, MCP servers | the user, in the UI |
| `~/.mulmoterminal/config.json` | Everything global. **Most of it has no UI** | these skills, or by hand |
| `<project>/.mulmoterminal.json` | Per-project appearance and behaviour. **No UI writes this file** | these skills only |

Settings' **Keyboard shortcuts** section is read-only, and its **Directory settings** section is a
read-only preview. Everything else below is a skill.

## Routing

Ask what they want to change — one `AskUserQuestion`, concrete options — then invoke that skill and
carry on there. Do not re-explain its contents here; the sibling skill is the source of truth.

| They want | Skill |
|---|---|
| Colours for a project, colour-coding several, grid/launcher order, a name badge, terminal font size or font | `mulmoterminal-dirs` |
| Their **own** colour scheme, appearing in Settings' picker | `mulmoterminal-theme` |
| Header buttons or info chips, globally or per project | `mulmoterminal-header` |
| Keyboard shortcuts, copy-on-select, Enter vs. newline | `mulmoterminal-keys` |
| Another model or backend (OpenRouter, a gateway, a per-project model) | `mulmoterminal-model` |
| Which moments beep or push, and what they play | `mulmoterminal-notify` |
| Something is broken and they don't know which setting | **Audit first** (below), then route |

If the request already names an area, skip the question. "Make this project blue" goes straight to
`mulmoterminal-dirs`.

Some requests span two skills, and that is normal — say so and do them in order. "Give my new repo
the same look as the others, in my own theme" is `mulmoterminal-theme` (define it once) then
`mulmoterminal-dirs` (pin it and set the colours).

## Audit — how is it configured now?

Reach for this when the user asks what their setup looks like, or says a setting "isn't working".
**Read; do not fix anything until you have reported and they have chosen.**

### 1. The global config

```sh
curl -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/config"
```

Falling back to reading `~/.mulmoterminal/config.json` directly is fine, but say which you used.

### 2. Each project

Take `cwdPresets` from the global config — the directories the user actually opens — and for each:

```sh
curl -sG "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/dir-config-detail" --data-urlencode "cwd=$path"
```

Let `curl` encode `cwd` (`-G` + `--data-urlencode`). Interpolating the path raw truncates at the
first `#` or `?` and mangles spaces, and a directory named that way is exactly the one someone
reaches for this audit about.

**Use this route rather than reading the file.** It returns what the app *actually parsed*: the
values in force, which keys the file set, and how each fared — **applied**, **dropped in
validation**, or **not a key we read**. Reading the file tells you what it says; only this tells you
what is in effect, and that gap is the entire content of "I set it and nothing happened". It also
resolves paths the way the app does, so a preset whose project was deleted answers as missing
instead of silently reporting on some other directory.

### 3. Report

Lead with **what is not in effect**, because that is what the user is asking about even when they
phrase it as a general question:

- **Dropped keys** — set in the file, rejected by validation. Name the key, the value, and why.
- **Unrecognised keys** — typos survive on purpose (`copyOnSlect` is kept, not deleted), which is
  what makes them findable. Say so; a kept key is not a working one.
- **Set but invisible** — a real setting doing nothing yet. The common ones:
  - `orderPriority` while the grid's ordering button is on auto or manual (the launcher's chips
    still use it).
  - Chrome colours while a session is busy or waiting — the working/attention colours take over,
    and the configured ones only show when the cell is idle.
  - A global change that needs a **tab reload**, or `fontFamily` / a provider key, which need a
    **server restart**.
- **Then** the settings that are working, grouped by area, briefly.

Offer to fix what you found, and route to the owning skill for anything they pick.

## Rules every one of these skills follows

State these when they matter; they are the ones that cost people an afternoon.

- **Global writes are a partial `POST /api/config` merge.** Write only the keys you are changing.
  Arrays (`themes`, `providers`, `buttons`, `chips`, `soundKinds`) **replace** rather than append —
  send them complete, or you delete the rest.
- **`<project>/.mulmoterminal.json` applies live, and writing it with your Write/Edit tool is
  itself the reload signal.** There is **no filesystem watcher**: a file the user edits by hand does
  nothing until something re-reads it. Always write it yourself rather than asking them to.
- **Read the existing file and merge before writing.** Never drop keys the user did not ask to
  change — these files are shared between skills.
- **Malformed values are silently dropped**, so an invalid field just never takes effect. Check with
  the audit above rather than assuming a write landed.
- **When it takes effect**: per-project → immediately. Most global → **reload the tab**.
  `fontFamily`, provider keys, and any hand-edit made while the server is running → **restart the
  server**.

## Two settings that live here

Small enough not to warrant their own skill.

### `skills` — the header's Skill menu, per project

The header's **Skill** dropdown lists a directory's Claude skills (`.claude/skills`, user +
project scope) and runs the one picked. `skills` is an **allowlist that also sets the order**: an
array (≤ 100) of slugs — only these appear, in this order. **Omit the key** to show every discovered
skill (working-directory ones first). Slugs that don't resolve are ignored.

```json
{ "skills": ["review-diff", "commit-msg"] }
```

### `appendSystemPrompt` — the closing summary

Every session is asked to end a reply with a short summary of what was asked, what was achieved and
what was not, under a `---` rule. It exists for the grid: coming back to a cell later, that is
otherwise only recoverable by scrolling the whole session.

```json
{ "appendSystemPrompt": false }
```

- **On by default**; only an explicit `false` turns it off. Set it globally in
  `~/.mulmoterminal/config.json`, or per project — **the project wins**.
- **Nothing in the app reads what the summary says.** Turning it off costs no feature; the roster's
  "last reply" and push notifications just become the raw tail of the reply.
- Applies to sessions started **from then on**. No restart, but a running session keeps what it
  launched with — reopen the cell.
- `true` / `false` only. There is **no way to substitute custom wording** — do not offer one.
- Independent of `prWorkdirFooter`: both ride on `--append-system-prompt`, and turning one off
  leaves the other.
