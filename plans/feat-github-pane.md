# GitHub pane — the PR/issue view beside a cell, not over the whole screen

## What is being asked

Three things, from the user:

1. The feature shows **PRs and issues**, so calling it "PRs" is wrong — it is the **GitHub** view.
2. Pressing the issue icon **replaces the whole screen** today. It should open in the **right-hand
   pane** of the grid, the way Canvas / Files / Collections do.
3. The list should lead with **the repository the open cell is in**. The first idea was to
   auto-scroll there; the user then refined it to "bring it to the top", which is better — see
   below.

And the decision on the edge case, from the user: a cell whose directory names no repository
**opens normally, in the conventional order**. Not an error, not an empty pane.

## Why "bring it to the top" rather than "scroll to it"

Scrolling is the weaker of the two and it was right to drop it:

- A scroll that lands slightly off looks like nothing happened.
- Every reload has to re-scroll, and the list reloads on open and on the refresh button.
- **A repo with no open PRs and no open issues has nothing to scroll to.** Reordering still says
  something ("your repo, 0 open") where scrolling silently does nothing.

Reordering is also nearly free: `/api/prs` and `/api/issues` already return **grouped by repo**
(`RepoPrs[]` / `RepoIssues[]`, each carrying `repo: string`), so this is an array move.

## Panel exclusivity — already answered, nothing to invent

The question "what happens when another panel is open" is settled by the existing design:

```ts
const paneByCell = ref(new Map<number, RightPane | null>());
```

One pane per cell, and `RightPane = "files" | "canvas" | "tools" | "collections"` are already
mutually exclusive. Adding `"github"` inherits that rule: opening it replaces whatever that cell
had open. No new mechanism, and no new state to keep in step.

## Resolving the cell's repository — no new endpoint

The app already knows `dir -> owner/repo`: `repoForDir()` (`server/git/forge-support.ts`) reads
`git config --get remote.origin.url` and parses it, and `server/git/repo-dirs.ts` caches the
answer for 60s. That is the mechanism the user guessed at, and it is already there.

But the pane does not need to call it at all. `GET /api/repo-dirs` returns the **reverse** map
(`repo -> local clones`), and the current overlay **already fetches it** — `loadRepoDirs()` runs
inside `load()`, because the issue rows need it to offer "start work here". So the cell's repo is
found by matching the cell's `cwd` against the candidate paths already in hand:

- no extra request
- no extra `git` subprocess
- nothing new to cache or invalidate

Path comparison goes through the repo's own `isSamePath` (`server/infra/path-within.ts` documents
why: Windows is case-insensitive, and a prefix is not containment). The candidate paths are the
canonical spelling `cwdPresets` stores, so this is a same-path test, not a containment one.

**Consequence worth stating:** a clone that is NOT registered in Settings resolves to no repo, and
that cell gets the conventional order. That matches the decision above and needs no special case —
but it does mean "my repo did not float to the top" has a mundane explanation.

## Shape of the change

`FilesOverlay.vue` already demonstrates the pattern this needs, in its own words: *"The full-screen
Files view: FilesPane in a fixed frame … Everything about browsing and editing lives in the pane —
what is here is the route coupling, which the pane beside a zoomed grid cell does not have."*

So:

- **`GithubPane.vue`** (new) — everything currently in `PrsOverlay.vue`'s body: the two fetches,
  the two sections, the rows. Takes `cwd` (nullable) and orders by it. Exposes a `#title` slot so
  each host writes its own header.
- **`GithubOverlay.vue`** (was `PrsOverlay.vue`) — the full-screen frame plus the route coupling,
  nothing else.
- **`TerminalGrid.vue`** — renders `GithubPane` with `:cwd="expandedCwd"`, exactly as
  `CollectionsPane` is rendered ("Scoped by the CELL's directory, not by a picker").
- **`RightPane`** in `src/components/gridCell.ts` gains `"github"`.

## Naming

- UI text and the cell button: **GitHub**.
- Route: **`/github`**, with **`/prs` kept as a redirect**. The old path may be bookmarked, and a
  redirect costs one line.
- `usePrsView` → `useGithubView`; `prsGotoIndex` → `githubGotoIndex`.
- **`/api/prs` and `/api/issues` are NOT renamed.** They are the wire, they are correct as they
  are (one endpoint per kind), and renaming them buys nothing while breaking anything that calls
  them. The rename is the user-facing name, not the plumbing.

## Tests

- Ordering is a pure function over `RepoPrs[]` / `RepoIssues[]` plus a cwd — extracted so it is
  testable without mounting anything (CLAUDE.md's "separate pure data transformation functions").
  Cases: match, no match, no cwd, repo present but empty, a cwd that is a candidate of two repos.
- A spec that the pane renders the matched repo's section first.
- A spec pinning that `RightPane` values and the cell buttons stay in step, so a sixth pane cannot
  be added to one and not the other.

## Not in scope

- Making the pane writable (starting work already exists via `IssueStartButton` and is carried
  over unchanged).
- Polling. The list loads on open and on the refresh button, as it does today.
