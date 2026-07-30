---
name: mulmoterminal-dirs
description: Colour-code and order the directories you actually work in, from wherever you are. Writes each project's `<project>/.mulmoterminal.json` — name badge, the seven chrome colours, xterm palette (`theme` / `colors`), terminal font size, and `orderPriority` (where it sits in the grid and in the launcher's chips). Starts from your recent MulmoTerminal directories rather than just the current one, reads the configs you already have, works out the convention you have been following, and continues it for the ones that are unset or off-pattern — so a newly cloned repo gets the colour and rank it should have had. Use when the user wants to colour-code, theme, rename, reorder, or resize projects in MulmoTerminal — "give this project a colour", "colour-code my repos", "keep my main repos at the top", "the new clone has no colour", "make them consistent", "terminal text is too small". For inventing a NEW reusable colour scheme that shows up in Settings, use mulmoterminal-theme instead.
---

# Colour and order the directories you work in

MulmoTerminal reads `<project>/.mulmoterminal.json` to style every terminal opened in that
directory. There is **no UI that writes this file** — this skill is the way it gets written.

Two files ship next to this one:

- `palettes.json` — colour presets grouped by vibe, for a user with nothing configured yet.
- `dir-config.schema.json` — the generated JSON Schema. "Schema" below matches it.

## The shape of this conversation

The unit of work is **the set of directories the user actually opens**, not the current one. Someone
who colour-codes projects is doing it so the grid is readable at a glance, and that only works if the
colours are decided against each other.

So: gather → infer → propose the whole set → apply → look → adjust.

Ask with `AskUserQuestion`, one decision at a time, always with concrete options. A beginner should
never have to invent a hex code.

### 1. Gather — the directories, and what they already say

Read `~/.mulmoterminal/config.json` and take `cwdPresets` (`[{ label, path }]`, most-recent first —
the same list the New-terminal launcher offers). That is the population.

Then, for **each** of those paths:

```sh
curl -sG "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/dir-config-detail" --data-urlencode "cwd=$path"
```

Let `curl` encode `cwd` (`-G` + `--data-urlencode`) rather than interpolating the path into the
query: a raw path truncates at the first `#` or `?` and mangles spaces.

Use this route, not your own read of the file. It returns what the app **actually parsed**: the
values in force, the keys the file set, and how each fared — applied, dropped in validation, or not
a key we read. A hand-read tells you what the file says; only this tells you what is *in effect*,
and the difference is the entire content of "I set it and nothing happened". It also resolves the
path the way the app does (a preset whose project has since been deleted answers as missing rather
than silently reporting on some other directory).

If the server is not running, fall back to reading each `.mulmoterminal.json` directly and say that
you could not check what was dropped.

If there are no `cwdPresets` yet, this is a fresh install: configure the current directory from a
preset in `palettes.json` and stop.

### 2. Infer — work out the convention already in use

**Do not skip to a preset when the user already has configs.** They have a scheme; your job is to
find it and extend it, not to replace it. Convert every configured colour to HSL and look for:

- **One hue per directory?** In a hand-made scheme, a directory's seven colours are usually one hue
  at different saturations and lightnesses. Check whether the hues within a directory agree.
- **Fixed saturation/lightness per role.** `badgeColor` dark and saturated, `headerColor` a little
  lighter, `cellColor` near-white, `cellBorderColor` and `dotColor` mid, `buttonColor` pale — the
  numbers repeat across directories even when the hue does not. Take the median of each role.
- **Hue bands by repository family.** `foo`, `foo2`, `foo3` are clones of one repo and usually sit
  in one band, stepping by a constant number of degrees per clone, often getting lighter as the
  number goes up. That step is what tells you what `foo6` should be.
- **`orderPriority` spacing and blocks.** Ranks are typically multiples of 10, grouped so one repo's
  clones are contiguous. You need the step and the free numbers.

**Show the user the rule you found before you use it**, as a small table — hue per family, the S/L
per role, the rank blocks. This is the step where a wrong inference gets caught, and it costs one
message. If the configs are too few or too inconsistent to support a rule, **say so** and fall back
to `palettes.json`; do not invent a pattern from two data points.

### 3. Classify — who needs what

Sort the population into three, and name them to the user:

- **On-pattern** — leave alone. Never rewrite a directory that already fits.
- **Unset** — no colours at all. These are the point of the exercise: a repo cloned last week that
  shows up grey.
- **Off-pattern** — configured, but not by the rule (a different saturation, a hue outside every
  band). **Ask before touching these.** They may be deliberate, and rewriting someone's one
  intentionally-odd project is worse than leaving it.

### 4. Propose the whole set at once

Give each target its values, derived from the rule:

- **Hue** — the next step in its family's band, or a free band if the repo is new. Keep it clear of
  every hue already in use; adjacent projects in the grid must not read as the same colour.
- **The seven colours** — that hue at the role S/L you measured.
- **`orderPriority`** — the next free rank in its family's block. If the block is full, say so and
  offer either a gap-filling rank or a renumber of that block.

`headerTextColor` is **not** part of the hue rule — it is whichever of white or near-black is
readable on `headerColor`. Decide it by WCAG relative luminance, not by a brightness approximation:
gamma-decode each channel (`c/255`, then `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`), weight
`0.2126 R + 0.7152 G + 0.0722 B`, and take whichever of black/white gives the higher contrast ratio
`(lighter+0.05)/(darker+0.05)`. The YIQ shortcut (`0.299/0.587/0.114` on raw channels) picks the
worse of the two for about 30% of colours — a vivid green header gets white text at 1.37:1, which is
unreadable. The app itself uses the WCAG rule (`src/components/contrast.ts`); match it.

### 5. Apply, then look at the real thing

Write each file, then let the user look. **The cells recolour immediately** — no page reload, no
server restart. Writing the file **with your Write/Edit tool is itself the reload signal**; there is
no filesystem watcher, so a file the user edits by hand does nothing until something re-reads it.

Do not try to preview colours with ANSI escapes. Claude Code does not render colour in tool output,
and a Bash child here has no controlling terminal (`/dev/tty` → `device not configured`). Verified —
don't spend a turn on it. Name the hex and say how it feels ("terracotta on near-black — cosy, low
glare"), then apply and let them look at the grid, which is the only exact preview.

**Read the existing file and merge before writing.** Never drop a key the user did not ask to change.

### 6. Refine, one axis at a time

Never "what colour do you want?". Offer: background darker / as-is / lighter · accent warmer /
cooler · header contrast subtle / strong. Apply and look after each. Two or three rounds is plenty.

The chrome colours only show while the cell is **idle** — the working/attention colours take over
while a session is busy or waiting on the user. Say this, or the user will change a colour, start a
session, and think nothing happened.

## Schema — `<project>/.mulmoterminal.json`

All keys optional. Colours are lowercase `#rrggbb` unless noted. MulmoTerminal **silently drops**
anything malformed, so an invalid field just doesn't take effect — which is why step 1 checks what
was dropped rather than trusting the file.

### Identity and chrome colours

| Key | Meaning |
|---|---|
| `name` | Badge label (≤ 40 chars). |
| `badgeColor` | Name-badge colour. |
| `headerColor` / `headerTextColor` | The cell header's background / text. |
| `cellColor` | Cell body background. |
| `cellBorderColor` | Cell border. |
| `dotColor` | Idle status dot. |
| `buttonColor` | Header icon buttons. |

### Terminal palette — `theme` and `colors`

The seven above tint the **chrome** around the terminal. These paint the **terminal contents**.

- `theme` — a palette id: one of the built-in `"midnight"` / `"nord"` / `"daylight"` /
  `"solarized"` (the id is `solarized`; "Solarized Light" is only its display label), **or the id of
  a scheme the user defined** in `themes` in `~/.mulmoterminal/config.json`. A directory naming a
  theme that isn't defined falls back rather than erroring, so check it exists. To create one, use
  the `mulmoterminal-theme` skill.
- `colors` — per-key overrides on top of `theme`. Keys are xterm ITheme names; values accept
  `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`. Valid keys: `foreground`, `background`, `cursor`,
  `cursorAccent`, `selectionBackground`, `selectionForeground`, `selectionInactiveBackground`, and
  the ANSI 16: `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white` `brightBlack`
  `brightRed` `brightGreen` `brightYellow` `brightBlue` `brightMagenta` `brightCyan` `brightWhite`.
  Unknown keys are dropped.

### Grid and launcher position — `orderPriority`

An integer rank. **Lowest first**; negatives allowed. Directories that set nothing sort last, keeping
their existing order, so ranking one project doesn't shuffle the rest. The rank belongs to the
*directory*, not the cell, so two cells on one directory share it.

It is read in **two** places:

- **The grid**, only in its **priority** sort mode (the toolbar's ordering button cycles auto →
  manual → priority). On auto or manual, nothing changes, whatever the projects declare — say this,
  or the user sets it and wonders why the grid looks the same.
- **The launcher's directory chips**, **always**, whichever mode the grid is on. The chips otherwise
  come in the order the directories were last launched, which moves under the user; ranking is how
  they get pinned. Unranked directories stay behind the ranked ones, in launch order.

Assign spaced ranks (10, 20, 30 …) so a project can be slotted in later without renumbering.

### Terminal font size — `fontSize`

Integer px, **8–32**, overriding the user's Settings value for this directory. Out of range is
**clamped** to the nearest end rather than dropped; a non-number is ignored. Omit unless asked —
inheriting the Settings value is the normal case.

Reach for it when the user says the terminal text is too small or too big, **especially if they
mention browser zoom**: zoom desynchronises xterm's cell grid from the PTY (drifting cursor, wrong
wrap points), while `fontSize` re-fits and tells the process its new size.

### Terminal font — `fontFamily`

A CSS font-family stack for this directory, e.g. `"'Cica', 'MS Gothic', monospace"`. Validated as
ONE unit: any unusable entry drops the whole stack, and `monospace` is appended when no generic
family is named.

Most users want this **globally** instead — it is the same font everywhere unless one project's
output is a different language. Both the global key and the per-directory one are covered here;
the global one lives in `~/.mulmoterminal/config.json`, has no Settings UI, and **needs a server
restart** (that file is read once at startup) — unlike this file, which applies instantly.

**Ask which fonts they actually have before writing one.** An uninstalled name silently does
nothing, which reads as the setting being broken. For CJK, prefer a face whose fullwidth glyphs are
exactly twice the Latin width (Cica, HackGen, Sarasa Mono J, Noto Sans Mono CJK JP, MS Gothic, BIZ
UDGothic); anything else tears the box-drawing frames an agent TUI is made of.

### Other keys in this file

`buttons` / `chips` → `mulmoterminal-header`. `provider` / `model` → `mulmoterminal-model`.
`sound` / `sounds` → `mulmoterminal-notify`. `skills` (the header Skill menu's allowlist and order)
and `appendSystemPrompt` (this directory's closing-summary override) → `mulmoterminal-config`.
**Preserve them when you merge** — this skill writes appearance keys and must not drop the rest.

## Example — continuing a convention

Four clones of one repo, stepping ~13° per clone and getting lighter, ranks in one block of 10s.
The fifth is unset; these are the values that continue the rule:

```json
{
  "name": "acme-web5",
  "badgeColor": "#1f6f8b",
  "headerColor": "#2b93b8",
  "headerTextColor": "#231f16",
  "cellColor": "#f2fafd",
  "cellBorderColor": "#4fb4d4",
  "dotColor": "#4fb4d4",
  "buttonColor": "#cfeaf4",
  "orderPriority": 60
}
```
