# feat(settings): group the Settings modal into categorised tabs (#1563)

## Problem

`src/components/SettingsModal.vue` stacks 24 headings in one 85vh scroll, 560px wide. There is no
search, no table of contents, no grouping. "Notification sounds" is the 8th heading down, and the
report that opened #1563 is someone who went looking for it and gave up.

## Decision

Follow MulmoClaude (`../mulmoclaude/src/components/SettingsModal.vue`, #1333): a left sidebar of
**grouped tabs**, one tab = one section = one pane. That repo is the reference host, its grouping
has shipped, and a user running both gets the same shape.

Two things this PR deliberately does NOT do:

- **No search box.** Not asked for in #1563, and grouping is the fix the report points at.
- **No Japanese.** The i18n half of the request is its own issue and its own PR — the tab and group
  labels land here as plain English strings, in one table, which is exactly the shape `t()` needs.

## Shape

### `src/components/settings/settingsTabs.ts` (new)

One table: group key → group label → the tabs under it, each `{ id, label }`. The label is the
section's heading text, and it lives HERE rather than in the section component:

- the sidebar and the pane heading would otherwise be two copies of the same string, and #1097 is
  what happens to the copy nobody remembers to edit;
- PR2 (i18n) then translates one table instead of hunting 23 `<h3>`s.

So every `*Section.vue` **loses its `<h3>`** and the modal's content pane renders the active tab's
label through `SECTION_HEADING`. A spec pins that every tab id renders and that the table's ids and
the modal's panes are the same set.

### Groups (9) and tabs (24)

Group order and within-group order both follow expected access frequency, as MulmoClaude's `GROUPS`
comment states for its own table.

| group | tabs |
| --- | --- |
| Appearance | Theme, Terminal font, Terminal font size, Terminal scroll speed, Waiting rows |
| Projects | Directory appearance, Directory settings |
| Header & launch | Launch commands, Header buttons and chips |
| Input | Terminal keys, Keyboard shortcuts, Voice input |
| Models & servers | Models and backends, MCP servers |
| Notifications | Notification sounds, Web Push notifications, Phone quick commands |
| Integrations | GitHub and GitLab, Pull request repos, Google account |
| Sessions | Sessions and background tasks, Sessions that survived a restart, Cost (estimated) |
| Help | Help & user guide |

### `ShortcutsSection.vue` splits in two

It is the one file carrying two headings. One tab per heading is the point of the sidebar — two
entries are two chances to find the thing — so it becomes `TerminalKeysSection.vue` (copy-on-select,
Enter behaviour) and `KeyboardShortcutsSection.vue` (the read-only keymap table + the
`mulmoterminal-keys` launch button). No behaviour moves.

### A pane is created on first visit, then hidden — not destroyed

A tab that has never been opened does not mount, so opening Settings for one setting no longer fires
20-odd GETs. Once visited it stays mounted and is hidden with `v-show` — **destroying it loses what a
section is holding but has not saved**, and `TerminalFontFamilySection` keeps a typed stack in a
local draft precisely so a failed POST does not throw it away. Arrowing past that tab was enough to
discard it (Codex review on #1565). Closing the modal still resets everything: the shells `v-if` the
modal itself.

The panes are wrapped in a `<div>` each rather than taking `v-show` directly, because most sections
are fragment-root components (`v-show` needs one element to set `display` on).

The cost: `VoiceInputSection` hides ITSELF today, behind a server capability probe. A hidden section
inside a visible tab is an empty pane, so **the probe moves up to the modal** and the Voice input tab
is filtered out of the sidebar when the machine cannot transcribe. The section becomes prop-free
markup. The probe only ever flips false → true (one GET on open), so no "the tab I am on vanished"
case exists.

### Dialog geometry

`w-[min(560px,92vw)]` → `w-[min(780px,94vw)]` with a fixed `h-[85vh]`, `w-40` nav column that scrolls
on its own, content column `flex-1 min-w-0 overflow-y-auto`. Fixed height so the dialog does not
resize under the pointer on every tab click, and because 9 group headers + 24 buttons need the room.

**Below `sm` the sidebar is a `<select>` above the pane**, its `<optgroup>`s being the groups. Found
by capturing the modal at 390px: a 160px sidebar left ~190px of pane, and the sound rows lost their
own labels off the left edge — worse than what this PR replaces. The nav and the picker write the
same `activeTab`.

### Two deliberate divergences from MulmoClaude

Its sidebar is a `<nav>` of plain buttons with `aria-current="page"`, and it has no narrow-screen
form. Both are followed here in shape but not in detail, because 24 entries is not 15 on a phone:

- **`role="tablist"` with roving tabindex and arrow keys.** 24 plain buttons are 24 Tab stops
  standing between the dialog and the setting it was opened for — more keystrokes than the flat
  scroll being replaced. Only the selected tab is tabbable; arrows move within the list and wrap.
  Selection follows focus (automatic activation), as `ThemeSection`'s radiogroup already does here.
  The modal's Tab trap is unaffected: it computes first/last from `MODAL_FOCUSABLE`, and both ends
  (the ✕ and the footer Close) stay tabbable.
- **the narrow-screen picker** above.

## Tests

`test/src/components/SettingsModal.spec.ts` mounts the modal and asserts on whatever rendered, which
was every section at once. Each test now opens the tab it is about, through one helper. Added:

- every tab in the table renders a pane, and no pane is unreachable from the sidebar
- the Voice input tab appears iff the probe says capable (and is absent when the probe fails)
- the sidebar's group order and the tab-to-group assignment (a table drifts silently otherwise)
- one Tab stop for the whole sidebar, arrows moving and wrapping within it
- the narrow-screen picker offering the same sections, grouped, and switching the pane
- a typed-but-unapplied font stack surviving a trip to another tab, and a never-opened tab not
  having mounted (the two halves of the visit rule — the first fails against plain `v-if`)

## Docs

Two screenshots showed the flat modal. Both are retaken against a scratch `HOME` (per CLAUDE.md: the
live config leaks real paths into the shot), on a real running server:

- `docs/guide/images/config-settings-modal.png` — the living guide's, replaced in place.
- `docs/guide/images/settings.png` — README's, **kept as it is** and replaced by a new
  `settings-tabs.png`. Two dated release pages (v2.1.0, v2.2.0) reference it, and a dated page is a
  snapshot of the screen it describes; overwriting it would rewrite their history.

`docs/guide/{en,ja}/config.md` listed the sections "in this order" and counted twenty-one (already
wrong — there were twenty-four). Both get the sidebar's grouping, the corrected count, and the table
reordered to match the nav. Reordering is done by script off `SETTINGS_GROUPS`, so no row is retyped.

Skill and guide prose already says "Settings → <section name>", which the sidebar makes more true
rather than less, so no wording changes are needed there.

## Follow-up

i18n (browser language with a Settings override, `en`/`ja` for this modal) is a separate issue and
PR, built on `settingsTabs.ts`.
