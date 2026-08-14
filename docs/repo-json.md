---
title: repo.json — an open repository metadata file
layout: default
nav_order: 4
description: A small, language-agnostic file that lets a repository say what it is and how it should be presented — name, description, icon and colours — with a namespace for tool-specific extensions.
---

# `repo.json` — an open repository metadata file

**Status:** draft (v0). Discussion: [receptron/mulmoterminal#1438](https://github.com/receptron/mulmoterminal/issues/1438).

A repository has no way to say **what it is and how it should look**. Tools that display
repositories — terminal grids, IDE tab colours, project switchers, dashboards — each invent their
own file, or guess. `repo.json` is one small file, in one place, that any of them can read.

## Why this doesn't already exist

It nearly does, four times over, and each one stops short.

| | Why it doesn't cover this |
|---|---|
| **Web App Manifest** (`site.webmanifest`) | Only web apps have one. It describes the **deployed app**, not the repository, and its icon paths resolve against the **web root** rather than the checkout. |
| **`package.json` / `Cargo.toml` / `pyproject.toml`** | One per ecosystem. A monorepo has five and none of them is "the repository". A machine-learning repo may have `pyproject.toml`, but that describes a distributable, not the project you are looking at. |
| **`codemeta.json` / `CITATION.cff`** | Built for academic citation. JSON-LD and author metadata; nothing about presentation. |
| **A forge's own description and topics** | Lives on the forge, not in the clone. Invisible offline, and to every tool that isn't that forge. |

The gap is measurable. Scanning 157 git repositories on one developer's machine:

```
git repositories          157
with a web app manifest     5   (3%)
with any favicon at all    26   (16%)   — every one of them a web project
the rest                  131          — ML, CLI, libraries, monorepos, docs
```

Those 131 are what this is for.

## The file

`repo.json`, at the root of the repository. Not a dotfile: this is declarative content **about the
project**, like `README.md`, `LICENSE` and `CITATION.cff` — not tool configuration like
`.gitignore` or `.editorconfig`. It is meant to be seen, and a specification nobody sees is a
specification nobody adopts.

UTF-8 JSON. Comments are not part of JSON; the samples here use `//` for explanation only.

```jsonc
{
  "name": "stable-diffusion-webui",
  "description": "Browser interface for Stable Diffusion",
  "icon": "assets/logo.svg",
  "color": "#7c3aed",
  "homepage": "https://example.com",
  "authors": ["Ada Lovelace <ada@example.com>"],

  "extensions": {
    "mulmoterminal": { "theme": "midnight", "badgeColor": "#5b21b6" }
  }
}
```

## Fields

**Every field is optional.** A consumer must work with an empty object, and an empty `repo.json`
is valid.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Display name. Not necessarily the directory or package name — this is what a human should see. |
| `description` | string | One line. What the project is, not how to install it. |
| `icon` | string \| array | The project's mark. See [Icons](#icons). |
| `color` | string \| object | Brand colour, or colours by role. See [Colours](#colours). |
| `homepage` | string | URL. |
| `authors` | array of strings | Free-form; `Name <email>` is conventional but not required. |
| `keywords` | array of strings | For search and grouping. |
| `extensions` | object | Tool-specific extensions. See [Extensions](#extensions). |

## Path resolution

**Relative paths resolve against the directory holding `repo.json`** — the repository root.

This is the single most important rule, and the one that separates this file from the formats it
resembles. A web app manifest resolves `/icon.png` against the *web root*, which in a typical Vite
or Next project means `public/`. A tool that carries that assumption over will find icons in web
projects and nowhere else — which is exactly the outcome this file exists to avoid.

A consumer **must not** follow a relative path outside the repository. `../../etc/passwd` is not a
mistake to tolerate quietly; it is a path the file was never entitled to name.

## Icons

`icon` is a string, or an array of objects when a project has several sizes.

```jsonc
"icon": "assets/logo.svg"

"icon": [
  { "src": "assets/logo.svg", "sizes": "any" },
  { "src": "assets/logo-192.png", "sizes": "192x192", "type": "image/png" }
]
```

**The two forms are equivalent**: `"icon": "x.png"` means exactly `"icon": [{ "src": "x.png" }]`.
An implementation normalises once and has a single code path afterwards.

| Field | | |
|---|---|---|
| `src` | **required** | A path relative to this file, or an `http(s)` / `data:` URL. |
| `sizes` | optional | Space-separated `<w>x<h>`, or `any` for a vector. |
| `type` | optional | MIME type. A **hint** — the extension is usually enough, and a wrong `type` must not stop a usable icon from being used. |

`sizes` and `type` borrow their syntax from the Web App Manifest. Only the syntax: there is no
reason to invent a second spelling for something already implemented everywhere.

### Choosing one

Without a stated rule, two tools show two different icons for the same repository.

1. **Prefer a vector** (`sizes: "any"`, or an SVG). Exact at any size.
2. Then the **largest** entry that covers the size needed. Scaling down is clean; scaling up is not.
3. On a tie, **the first listed**. Author order carries intent.
4. **Skip an entry that does not resolve and continue.** A missing file, an unreadable one, a dead
   URL — none of them may hide the working entries after it.

Rule 4 is not theoretical. An implementation that stopped at the first entry that *existed* let one
unusable high-priority file bury every good one behind it. "Keep going until one **resolves**" is
the rule; "until one exists" is the bug.

## Colours

```jsonc
"color": "#7c3aed"

"color": {
  "primary": "#7c3aed",     // the brand colour. If you set one thing, set this
  "accent": "#22d3ee",      // secondary, for highlights
  "background": "#0b1020"   // the surface the other two sit on
}
```

**The two forms are equivalent**: `"color": "#7c3aed"` means exactly
`{ "primary": "#7c3aed" }` — the same shorthand rule `icon` follows.

> **Where a field has an obvious primary value, the scalar form is shorthand for the fullest form.**
> One rule, stated once, covering both fields. An implementation normalises at the boundary and has
> a single code path afterwards.

Three roles, because one is too thin to render with and more than three is a design system rather
than an identity. The Web App Manifest already carries two (`theme_color`, `background_color`);
Material names three (primary, secondary, surface). All three are optional, and a consumer **must**
be able to work from `primary` alone.

**`#rgb` and `#rrggbb` only.** Allowing the whole CSS colour syntax means implementations disagree
about what a colour is.

### Text colour is never declared

There is no `textColor`, and there must not be one. A consumer **derives** the readable foreground
from whatever it is painting on, using WCAG relative luminance:

> gamma-decode each channel (`c/255`, then `c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`), weight
> `0.2126 R + 0.7152 G + 0.0722 B`, and take whichever of black or white gives the higher contrast
> ratio `(lighter + 0.05) / (darker + 0.05)`.

Declared text colours produce unreadable combinations, because the author cannot know what surface
a given tool will paint on. Deriving it also makes every conforming tool reach the same answer.
The common shortcut — YIQ brightness on raw channels — picks the worse of black and white for
roughly 30% of colours, so it is not an acceptable substitute.

### Deriving what isn't declared

A consumer that needs more colours than three should **derive them from `primary`** rather than ask
the author for more. This is not a hope: MulmoTerminal paints seven, and deriving all seven from
`primary` alone reproduces eleven hand-tuned palettes to a **median ΔE76 of 1.9, worst case 2.5**.
The median sits below 2.3, the threshold at which a difference becomes noticeable at all; the worst
single role sits just above it. One of the derived values came out byte-identical to the
hand-picked one.

What the measurement also showed is that a single rule does not fit every role. Snapping every role
to a fixed saturation/lightness drifts by ΔE 20 at the dark end; making every role a fixed offset
from `primary` drifts by ΔE 15 at the pale end. The roles differ in kind: a **badge** sits relative
to the brand colour, while **surfaces** sit at absolute lightness whatever the brand colour is. A
consumer deriving a palette should expect to do both.

### Light and dark

v0 defines **one** set of colours, and expects consumers to adapt: derive the foreground as above,
and adjust surfaces to the theme in force. A `color.dark` override is a plausible future addition
and is reserved; it is left out of v0 because most of what it would buy is already covered by
deriving contrast, and a field that authors fill in inconsistently is worse than no field.

## Extensions

Tool-specific settings go under `extensions`, keyed by tool name:

```jsonc
"extensions": {
  "mulmoterminal": { "theme": "midnight", "badgeColor": "#5b21b6" },
  "some-other-tool": { "…": "…" }
}
```

The noun is OpenAPI's — it calls `x-` entries **Specification Extensions** — while the shape is
devcontainer's: one reserved object with tools namespaced inside. `tools` was the obvious name and
is the wrong one: in a world of MCP and function calling, "tools" already means something else
entirely, and a reader would take it for a list of tools the repository *provides*.

The core stays small and every tool gets somewhere to put what only it understands. This is the
same shape four established formats already use — devcontainer's `customizations.<tool>`,
`pyproject.toml`'s `[tool.<name>]`, `Cargo.toml`'s `[package.metadata.<name>]`, OpenAPI's
`x-<vendor>` — and the first three are the better model: one reserved object, tools namespaced
inside it, so the top level never fills up with prefixes.

Pick a name you demonstrably own — a published package name, a GitHub organisation, or reverse
DNS. `pyproject.toml` makes this a hard rule (you may use `[tool.$NAME]` only if you own `$NAME`
on PyPI); here it is a convention, since there is no registry to check against.

**A consumer must ignore `extensions` entries it does not own, and must preserve them when
rewriting the file.** Dropping another tool's settings on save is the fastest way to make this format
unusable.

## Precedence

A repository can carry several of these. Tools that disagree about which to read show the same
repository differently, so the order is part of the specification:

1. **`repo.json`** — written for this purpose; it wins.
2. **The ecosystem manifest** — `package.json`, `Cargo.toml`, `pyproject.toml`, a web app manifest.
   Useful for `name` and `description`, which they already carry.
3. **Convention** — `public/favicon.svg`, `apple-touch-icon.png`, and friends, for an icon.

Per field, not per file: a `repo.json` that sets only `icon` leaves `name` to be found at step 2.

## Conformance

- Every field is optional; an empty object is valid.
- **Unknown keys are preserved, never an error.** Today's unknown key is tomorrow's field, or
  another tool's extension.
- **An invalid value is ignored, not fatal.** A malformed colour drops that colour; it does not
  drop the file. A consumer that refuses to read a file over one bad field turns a cosmetic
  mistake into a broken project.
- A consumer **should** be able to say which fields it applied and which it dropped. "I set it and
  nothing happened" is the most common failure of a format like this, and it is only debuggable if
  something reports it.

## Examples

A machine-learning repository — no web assets, no package registry:

```json
{
  "name": "diffusion-lab",
  "description": "Training and evaluation for latent diffusion models",
  "icon": "docs/logo.png",
  "color": "#0f766e"
}
```

A monorepo, where no single ecosystem manifest speaks for the whole:

```json
{
  "name": "acme platform",
  "description": "Web, API and infrastructure in one tree",
  "icon": [
    { "src": "brand/mark.svg", "sizes": "any" },
    { "src": "brand/mark-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "color": { "primary": "#1d4ed8", "accent": "#f59e0b", "background": "#0b1020" }
}
```

A web project that already has a favicon — `repo.json` adds only what the existing files cannot say:

```json
{
  "name": "acme.com",
  "color": "#be123c",
  "extensions": { "mulmoterminal": { "orderPriority": 20 } }
}
```

## Open questions

- **`color.dark`** — worth adding, or does deriving contrast cover it?
- **Enforcing `extensions.<name>` ownership** — is a convention enough without a registry?
- **Forge rendering** — `name` + `icon` + `color` is exactly a repository card. Worth proposing
  to GitHub/GitLab once the format has more than one implementation.
