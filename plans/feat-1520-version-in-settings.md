# feat: show the running version in Settings (#1520)

## Problem

Nothing in the UI says which version is running. The header's "Update" badge only appears when
something newer exists, and it names the update — never the current build. A user has to leave
the app and run `npx mulmoterminal@latest --version` to answer "what am I on?", which is also the
first thing a bug report needs.

## What to show

Two installs, two different answers — the update check already distinguishes them
(`classifyInstall` in `bin/update-check.js`), so the display follows the same split:

- **npm** — the version from the shipped `package.json`, plus the registry's latest when it is
  newer (the thing the user would upgrade to).
- **git** — the same version plus the **short HEAD sha**, because a checkout's `package.json`
  version is whatever was last released and says nothing about which commit is running.

Placement: a muted line directly under the **Settings** heading, so it is visible the moment the
modal opens rather than at the bottom of ~24 sections. Matches MulmoClaude, which puts its app
version under the same title (`data-testid="settings-app-version"`).

## Server

`bin/update-check.js` already probes everything needed — it just throws the facts away and
returns one rendered string. Restructure so one pass of the probes yields the facts, and the
notice is derived from them:

- `readInstallInfo(pkgDir, currentVersion, deps)` → `{ install, version, commit }`. Local only:
  the work-tree probe, and `rev-parse --short HEAD` for a git install. No network, so it is also
  what runs when the update check is opted out (`MULMOTERMINAL_NO_UPDATE_CHECK` silences the
  *notice*; it must not blank the version).
- `computeUpdateInfo(pkgDir, currentVersion, deps)` → the above plus `{ latest, notice }`.
- `computeUpdateNotice` stays, delegating to `computeUpdateInfo`, so the launcher's console line
  and the header badge keep their exact wording.

`gitUpdateNotice_` takes the short sha it no longer needs to re-read, so the extra probe costs
nothing. A dirty tree still skips `ls-remote` — its only product is a notice a dirty tree is
never shown.

`server/config/update-status.ts` caches the whole structure and `/api/update-status` serves it.
The payload gains `ready`, set once the startup check has landed: today the client polls "while
notice is null", which cannot tell *up to date* from *not finished yet* — fine for a badge that
renders nothing either way, wrong for a commit sha that would simply never appear.

The wire shape moves to `common/updateStatus.ts` (both sides decide from it) with a parser, so
the client reads fields it has checked rather than off an `any`.

## UI

- `useUpdateStatus` becomes a module singleton: two consumers now (header badge, settings line),
  and the modal should show the answer the app already has instead of re-fetching on every open.
  Polling stops on `ready`.
- `versionDisplay(status)` in `src/composables/updateNotice.ts` — pure, next to
  `parseUpdateNotice`, covered by its spec. It answers the version and the commit as separate
  fields rather than one joined string, because the line labels them separately.
- `src/components/settings/AppVersionLine.vue` — a **Version** row: a `deployed_code` icon, the
  label, the version as a chip, and a `commit <sha>` chip on a checkout; then the notice, with the
  header badge's `upgrade` icon, when behind. Labelled rather than a bare `v4.7.0 · a1b2c3d`,
  which under a title reads as decoration and leaves the reader to guess what the hex is. No copy
  button: the header badge already owns that popover.

## Tests

- `test/bin/update-check.spec.ts` — npm/git info, opted-out shape, dirty tree keeps the commit.
- `test/server/config/update-status.spec.ts` — cached structure, opt-out uses the local read.
- `test/src/composables/updateNotice.spec.ts` — `versionLabel` for both installs.
- `test/src/components/settings/AppVersionLine.spec.ts` — the labelled row, the commit chip, and
  that the version shows before the probe lands while the commit waits for `ready`. The row is
  hidden only when no status could be read at all — the version itself is known synchronously and
  is the same value either way, so blanking it for the length of the probe would buy nothing.

## Docs

README's Settings description and the bilingual guide gain a line about where the version lives.
