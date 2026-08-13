---
title: GitHub — cross-repo PRs & Issues
layout: default
parent: English
nav_order: 10
description: See every registered repository's open PRs and issues in one cross-repo view.
---

# GitHub — cross-repo PRs & Issues
{: .no_toc }

- TOC
{:toc}

**See open Pull Requests and Issues across several repositories on one screen.** Which repo has
something waiting for review, whether CI is red — all at a glance, without hopping between sessions.
You choose which repos show up by **registering** them (just a list of `owner/repo`).

- A full-screen view opened from the toolbar's **Pull requests** button (`call_merge` icon).
- Shows **both open PRs and Issues**, grouped **per repository**.
- Data comes through the **GitHub CLI (`gh`)** — it **uses your `gh` login**, so no token is stored in the app.

---

## 1. Register the repos you want to see

Only the repos you **register** appear (nothing is auto-added from worktrees or sessions). Two ways,
both effective **immediately** (no restart).

### From the Settings modal (recommended)

1. Open **Settings → Pull request repos**.
2. Type an **`owner/repo`** (e.g. `receptron/mulmoterminal`) and click **Add**.
3. Added repos are listed; remove any with its **✕**.

> The format is `owner/repo` only (no spaces, paths, or `https://…`). The value is passed straight
> to `gh --repo`, so only a bare `owner/repo` slug is valid.

### By editing the config file

Add to **`prRepos`** (an array of `"owner/repo"` strings) in `~/.mulmoterminal/config.json`:

```json
{
  "prRepos": ["acme/web", "acme/api"]
}
```

→ See [Configuration](config.html) for the full key list.

## 2. Open the view and read it

Click **Pull requests** (`call_merge`) in the toolbar to open the **PRs & Issues** view (it sits
between **Accounting** and **Wiki**).

- A **Pull requests** section on top, an **Issues** section below. Both are grouped **per repository**
  (an `owner/repo` heading with a count).
- Only **open** items are shown. Order is your registration order (repos) and whatever `gh` returns (items).
- **Clicking a row opens it on GitHub in a new tab** (nothing opens in-app).
- **↻ (Reload)** at the top re-fetches. **There is no auto-refresh** — it loads once when you open the
  view, then only on Reload.

### What a PR row shows

| Element | Meaning |
|---|---|
| **● CI dot** | green = checks passing / red = failing / amber = running / dim = no checks |
| **#number · title** | the PR number and title |
| **draft** | shown for draft PRs |
| **approved / changes requested / review required** | review state |
| **author · relative time** | e.g. `alice · 2h ago` (last updated) |

An Issue row shows **#number · title · author · relative time**, plus a **▶ start** button on the
right — see below.

> Up to **100 PRs / 20 Issues per repo**. Beyond that, a "there are more" note appears with a link to GitHub.

## 3. Start work on an issue from its row

The **▶** button at the end of an issue row does the whole setup in one click:

1. reads the issue (title and body),
2. creates a **`issue/<number>-<slug>` worktree** in your clone of that repo, forked from a freshly
   fetched `origin/<base>`,
3. starts **Claude** in that worktree as a grid cell, with the issue **already typed into the input
   box** — and **not sent**. You read it, edit it if you like, and press Enter yourself.

Because the branch carries the issue number, everything downstream follows without being told again:
the ⧉ Open PR button writes `Fixes #<number>` into the PR body, and the header's work-item chip, the
issue work comment and the merge-time auto-close all read the same number.

**If you keep several clones of one repo**, the button asks which one the first time and remembers
your answer (`repoDirs` in the config); after that it is one click. **If you have no clone of that
repo**, the button is disabled and says so — register the directory in Settings → directory presets
to enable it.

> The issue body is text written by whoever opened the issue, which is often not you. That is why it
> is left in the input box rather than sent: the Enter is yours.

## Prerequisite: sign in to the GitHub CLI

The view runs the **`gh`** command behind the scenes. On the machine running the server:

```bash
gh auth login
```

- The app stores/reads no token — it works with **your `gh` login**.
- Repos always come from **server-side config** (never from the request).
- Each repo is fetched **in parallel**; only a **failing repo** shows its error (the others still load).

## If nothing shows up

- **"No repositories configured…"** → nothing registered yet. Add `owner/repo` under **Settings → Pull request repos**.
- **"gh not found…"** → install the GitHub CLI and run `gh auth login`.
- **One repo errors** → check the spelling (`owner/repo`) and your **`gh` access** to it (private repos need permission).
- **A PR you just opened is missing** → there's no auto-refresh, so hit **↻ Reload**. Still missing? Confirm it's open and the `owner/repo` is right.
- **Counts are capped** → the limits are 100 PRs / 20 Issues per repo; see the rest via the GitHub links.

---

← [Feature reference](features.html) / [Configuration](config.html) / [English guide index](index.html)
