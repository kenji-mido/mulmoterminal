# Handoff: collections in any project folder

Written 2026-08-09, at the end of the session that built this. It replaces a long
conversation, so it says what was decided and why — not just what is left.

**Read first**: [`feat-collections-project-root.md`](./feat-collections-project-root.md)
(the consumer-side plan: decisions, phases, §7c the gap audit, §11 clone parity) and
[`project-architecture.md`](./project-architecture.md) (why a Project IS a directory, and why the
four per-project subsystems are one problem). This file is the map on top of those.

---

## 1. Where it stands

**It works end to end, verified in the field.** An agent in `~/git/ai/mag2` was asked to create a
collection, and did: `putSchema` wrote `.claude/skills/newsletters/schema.json` in THAT repo, 168
records landed in `data/newsletters/items/`, `queryItems` aggregated them, and
`presentCollection` rendered the card.

Shipped to MulmoTerminal main:

| PR | What |
|---|---|
| #1571 | `resolveProjectRoot` + the root threaded through ~30 engine calls; the engine bound in EXPLICIT-ROOT mode so a forgotten root throws instead of resolving the workspace |
| #1572 | `?project=<opaque id>`, `GET /api/collection-projects`, and everything keyed by slug alone re-keyed by `(root, slug)` — view tokens, the thumbnail cache, the query cap |
| #1573 | The Collections pane beside Canvas / Tools / Files, scoped to the cell's directory; the agent's `manageCollection` follows its session's cwd; a collection action's chat spawns in the collection's root |
| #1578 | `@mulmoclaude/core@3.1.0`: staging (`data/skills`) is workspace-only, and `schemaDocs` serves a root-appropriate authoring guide |
| #1579 | The canvas is a scope surface, so a `presentCollection` card fetches its own session's project |

Upstream (`@mulmoclaude/core@3.1.0`, receptron/mulmoclaude#2844 — instructions in
`../mulmoclaude/plans/feat-collection-multi-root-2.md`) shipped MORE than MulmoTerminal currently
uses. Confirmed present in the installed package:

- `skillsStagingDir` may return `null`; `schemaDocs` picks its variant from that plus
  `stagedSkillAuthoring` — **both wired**
- **`startCollectionWatchers` mounts one generation PER ROOT, concurrently**, each stamping its
  root on payloads and driving bells whose ids carry it; `stopCollectionWatchers({ workspaceRoot })`
  stops exactly one — **wired** (§3.1)
- `buildNavigateTarget(slug, itemId, root?)` — the adapter receives the root — **used** (§3.2)
- `withCardScope` for per-card project — **blocked, see §3.3**
- `feedRefreshTaskDef({ workspaceRoot })` with a per-root task id — MT registers one, for the
  workspace only

---

## 2. The invariants — read these before writing anything

Every one of these was learned by breaking it. Reviews caught roughly fifteen findings on these
PRs and they were nearly all one of the following.

1. **A slug is unique within a root and nowhere else.** Anything keyed on a slug alone — a cache,
   a channel, a token, a notification id, a card — is a cross-project collision waiting to happen.
2. **Presence, not shape, when reading `?project=`.** Express turns `?project=a&project=b` into an
   array; a `typeof === "string"` guard reads that as "absent" and serves the workspace to a
   request that explicitly named a project. `resolveProjectRoot` and `/api/files/raw` both do this
   correctly — copy them.
3. **The root is the trust boundary.** `resolveDataDir` only guarantees containment WITHIN the
   root it is handed. A client may name a project by opaque id, resolved against the server's own
   list; it may never supply a path. A SESSION's cwd is different — that is the server's own
   record of where it launched an agent, and `projectScopeForCwd` accepts it without a membership
   check on purpose.
4. **A view token carries the opaque id, never a path.** Tokens are signed, not encrypted, and are
   handed to an LLM-authored iframe.
5. **`dataUrl` is a bare base URL and must stay one.** The custom-view contract builds endpoints by
   concatenation (`dataUrl + "?fields="`, `+ "/query"`, `+ "/image?…"`). Appending a query to it
   breaks every one.
6. **Scope and navigation belong to the SURFACE being looked at** (`src/composables/collectionSurface.ts`).
   Precedence is by layer first (`"screen"` covers `"pane"`), push order second — a tool result can
   auto-reveal a canvas behind an open browser. A surface may scope without navigating.
7. **`data/skills` is the managed workspace's alone.** It exists to cross the `.claude/`
   permission gate, and MulmoTerminal runs no bridge outside the workspace. Telling the agent
   otherwise makes it write a draft nothing mirrors and nothing discovers — a collection that does
   not exist, with no error anywhere.
8. **Stubbed deps hide wiring bugs.** CI was green on a commit where every calendar-push request
   would have 500'd, because every test for that route injected stubs. When a route resolves a
   root, test it through its LIVE deps too.

---

## 3. What is left

Ordered by how much it hurts today. §3.1 and §3.2 are now done — kept here, marked, because what
was decided about them (which roots get a watcher, and why the adapter must not import server
infra) is what the next reader needs.

### 3.1 Per-root watchers — DONE

`server/backends/collectionWatchers.ts` now mounts **one generation per known project** — the
workspace and every saved `cwdPresets` directory — instead of one for the workspace. So a
project's collections get their completion bells and their live refresh on a direct file write,
which is the canonical authoring path.

- **"Open" means "a project this server serves"**, not "a project on screen". A completion bell is
  the notification that the user is NOT looking, so scoping the watchers to the open Collections
  pane would mean a bell can only ring while its collection is already visible. The inotify cost is
  bounded by discovery: a root with no collections mounts no watcher.
- The watched set is reconciled by a **60s poll** (`syncCollectionWatcherRoots`, exported so a
  caller that knows the list just changed can pull the pass forward). A poll because
  `listProjectRoots` reads a live thunk over `cwdPresets` and nothing emits when it changes.
- A root that fails to start does not stop the roots after it, is warned about **once**, and is
  retried on the next pass. Errors carry their `code` (`COLLECTION_ROOT_REQUIRED` distinguishes a
  wiring bug in this file from one directory's problem).
- `WATCHER_ROOT_CONFLICT` is no longer thrown by core 3.1.0 — a second root mounts a second
  generation. `feat-collections-project-root.md` §7b describes the 3.0.0 contract and is now
  historical on that point.

The poll is now the FALLBACK, not the only path: `POST /api/config` reports when the saved-directory
list actually moved (by path — a relabel is the same directory) and `app-routes.ts` pulls the sync
forward. `cli-init` writes before the server runs, so it needs nothing. The callback is injected
rather than imported, so the config module stays config-shaped.

### 3.2 Notification deep links — DONE

A bell now carries its project, as the **opaque id**, both in the URL
(`/collections/<slug>?selected=<itemId>&project=<id>`) and on `action.target.project`.

- `buildNavigateTarget` / `buildPluginData` take the project, and
  **`collectionWatchers.ts` resolves root → id** (`projectIdForRoot`, new in `project-root.ts`).
  The adapter stays free of server infra deliberately: `test/src/utils/collectionNotified.spec.ts`
  imports it, so pulling `node:crypto` in through it puts Node's globals into a DOM-typed project
  and `window.setTimeout` stops returning a number — a real, confusing typecheck failure.
- **Cross-app parity holds where it is observable**: the id is omitted for the workspace, so the
  only link MulmoClaude can produce or receive is byte-for-byte what it was.
- The client half: `browseRouteProjectId()` reads it from the route query, the browse pushes
  **carry** the open project (a ref hop inside a project stays in it) while a bell passes its own
  explicitly (`null` for a workspace bell, so it does not inherit an open project), and
  `CollectionsBrowseOverlay`'s surface takes its `projectId` from the route via a getter. The
  plugin views are **keyed** by project so a same-path project switch refetches.
- `collectionNotifiedSeverities` now matches the project too. That is not theoretical: with a
  `primaryKey` schema the record id is drawn from the data, so the same record in two projects has
  the SAME id and an unscoped reader accents the wrong card reliably rather than rarely.

Still open (upstream): MT publishes ROOTED bell ids while MulmoClaude publishes root-less ones for
the same workspace. Core's sweep handles it asymmetrically — MT's rooted sweep clears a root-less
entry (`drop-legacy`) and republishes, while MulmoClaude's root-less sweep `skip`s a rooted one, so
alternating between the apps can leave a stale bell MulmoClaude will not clear. Pre-existing since
#1571, by upstream design, and worth confirming with MulmoClaude before anyone "fixes" it here.

### 3.3 Per-card project scope — DONE (core 3.2.0 / collection-plugin 3.1.0)

The plugin now reads `PresentCollectionData.scope` and asks the HOST for a binding of its own
(`withScope`, an optional entry on the binding — a single-workspace host omits it and nothing
changes). MulmoTerminal implements it by building the whole binding from a PROJECT RESOLVER
(`makeCollectionUi(projectIdOf)`): the global one resolves the ambient surface, a card's resolves
the fixed scope it was made in.

The bug it closes: a card built in project A showed project B's records the moment the user moved
the app — same slug, same title, different rows, nothing saying so.

Everything project-dependent goes through `scopedUrl` / `projectIdOf`, and everything that does
NOT is built outside the factory (`PROJECT_INDEPENDENT`) — which is where that is proved rather
than asserted. Navigation is the interesting member of that set: it is per-SURFACE, not per
project, because a click inside a pane moves that pane and a card's scope has nothing to say
about where a link goes.

### 3.4 The phone (§7c E) — PREPARATION DONE

The command handlers no longer hard-code the workspace. `server/backends/remoteHost/commandScope.ts`
resolves a scope from the command's params, defaulting to the host's root, and every collection /
feed / skill handler calls it — so the day a phone gains a project picker, the picker is the only
new thing (`../mulmoclaude/plans/feat-collection-multi-root-2.md` §8, item 3).

**No behaviour changed**: nothing sends `project` yet, so every command resolves the same root it
did before.

- The param name and reader are core's (`COMMAND_SCOPE_PARAM`, `readCommandScope`) — the wire name
  was already reserved upstream, so nothing here invents one.
- **An opaque id, never a path.** A path in a command would publish the user's home directory over
  the wire and make every handler an arbitrary-directory reader; the id resolves against the
  server's own list, and a spec pins that a real path is REFUSED.
- **A named-but-unknown project THROWS**, which is a deliberate divergence from the wording on
  core's `readCommandScope` ("fall back to the default"). Falling back would serve the workspace's
  records to a phone that asked for a project's — the silent wrong-root answer the HTTP side
  answers 400 for. An ABSENT scope still defaults, which is what that rule is really about.
- `getCollection` and `getFeed` build their deps once, so the scope is threaded through the deps
  per call rather than captured at construction — the one shape a later `project` param could not
  have changed.

`listCollectionProjects` completes the host half: the handlers could already resolve a project a
command NAMES, and this is how the phone learns which ids exist. It carries id + label and
deliberately NOT the cwd the browser listing has — the browser needs the path to match a project to
a cell it is already showing, and the phone, being genuinely remote, must not be handed one.
`docs/remote-host-protocol.md` documents the parameter, the listing, and the three rules (opaque
id; omitted means the workspace; an unresolvable id is an error, not a fallback).

Still missing, and it is not in this repo: the phone's own project picker.

### 3.5 Per-root scheduled feed refresh — DONE (core 3.2.0), after one revert

`buildSystemTasks` registers one `feedRefreshTaskDef` per root — the workspace plus every saved
project directory. A task id is the scheduler's primary key and core builds it from the root, so N
roots register N tasks; roots dedupe by RESOLVED path, since core canonicalises the root into the
id and two spellings would collapse to one registration. Read at boot, because the scheduler
registers once.

**It shipped once and was reverted (#1582), and the reason is worth keeping.** A collection with
`ingest.kind: "agent"` refreshes by dispatching a hidden worker, and the seed prompt addresses the
records ROOT-RELATIVELY (`promptPathsFor` emits the schema's `dataPath` verbatim). The runner was
handed no root, so the worker started in the host's workspace and a project's scheduled refresh
wrote into the WORKSPACE's same-named collection — silently, since both paths exist and neither
side errors.

core 3.2.0 forwards the root to `AgentWorkerRunner` (the upstream ask written up in
`../mulmoclaude/plans/feat-collection-multi-root-3.md`, shipped as receptron/mulmoclaude#2849), and
`feedWorkerSpawnOptions` turns it into the worker's cwd. That one option is the whole difference
between refreshing a project and filling the workspace instead, which is why it has a file and a
spec of its own.

The calendar stays workspace-only: a Google grant is user-scope and its sync marker is workspace
state, so a per-project sync would need a per-project answer to "which account" that nothing here
has.

### 3.6 The self-containment check — DONE

`server/backends/collectionSelfContainment.ts` answers "would this collection survive a clone?",
served at `GET /api/collections/:slug/self-containment` (project-scoped like every other read; the
module mounts its own route because `collections.ts` is at its line budget).

Five rules, each named for what breaks on the OTHER machine:

| code | severity | what goes wrong there |
|---|---|---|
| `user-scope` | blocker | the skill is in `~/.claude/skills`; the clone gets whatever that machine has |
| `data-ignored` | blocker | schema committed, records not — reads as an empty collection |
| `sqlite-store` | blocker | one binary file; git cannot merge it |
| `csv-runtime` | warning | the file travels, the DuckDB runtime must be there too |
| `no-primary-key` | warning | 4-byte random ids, so two machines can mint the same one |
| `not-a-repo` | info | nothing to clone yet; the git-dependent checks did not run |

Two decisions worth keeping:

- **It asks git, it does not parse `.gitignore`.** The rule that matters may come from a parent
  directory, `.git/info/exclude`, or the user's global ignore file. `--no-index` is passed so the
  answer is about the RULE rather than current tracking — a data dir that is already tracked reads
  as "not ignored" without it, which is true of the files already committed and misleading about
  every record written from now on.
- **Unknown is not clean.** `dataDirIgnored` is `boolean | null`, and `null` (no repo, no git)
  reports nothing rather than clearing the collection.

**Surfaced in the Collections pane** (a strip below the plugin's views, outside its shadow root):
a "Survives a clone?" button while a collection is open, then the findings, coloured by severity.
A BUTTON rather than something computed on open, because the answer changes without the collection
changing — a `.gitignore` line lands, `git init` runs, the skill moves into the project.

The wire shape lives in `common/collectionPortability.ts`, since both sides decide from it. The
finding's `code` is a plain `string` there on purpose: a newer server may report one this build has
never heard of, and narrowing would drop a real finding behind a version skew. `severity` IS
narrowed — it decides how the row renders. A spec pins that the server only ever produces a
documented code.

**The agent gets it too**, on the one action that can change the answer: a successful `putSchema`
carries the findings back as a `portability` field beside `written: true`
(`server/infra/collectionToolPortability.ts`). The agent is the one that chose the storage kind or
dropped the `primaryKey`, and it is holding the file open at the moment that is cheapest to fix.

Quiet by construction: a clean collection is not mentioned, a refusal (which is PROSE the agent is
meant to act on) is passed through untouched, every other action is left alone rather than spending
a git call per listing, and a failure of the check itself changes nothing about the write.

Still missing: a creation-time hook. There is nowhere to put one — creation is a plain file write
the engine never sees (`putSchema` refuses an unknown collection and tells the agent to create it
by writing SKILL.md + schema.json), so the first moment the host can speak is the schema edit that
follows. §11.4's "at collection-creation time" is answered by that, not by a hook.

### 3.7 A live browser check — DONE

**How it is run** (repeatable, and it touches neither the live config nor a real project): start a
server from this checkout with `HOME` pointed at a scratch dir holding its own
`.mulmoterminal/config.json`, `CLAUDE_CWD` at an empty scratch workspace, and `PORT` on a free
port. Drive Chromium with the Playwright already installed in a sibling checkout
(`../mulmoclaude/node_modules/playwright`) — this repo gains no dependency. The scratch project is
a real git repo with one collection whose `data/` is gitignored, so the portability rules have
something true to say.

**What it proved (2026-08-09), none of which a unit test can see:**

- The per-root watchers mount for real: the boot log says
  `collection completion watchers started { roots: 2 }` and a watcher for the scratch project's own
  collection. §3.1 had never been observed in a live process.
- `/collections` shows "No collections installed" for the empty workspace, while
  `/collections?project=<id>` shows the PROJECT's collection, and
  `/collections/<slug>?project=<id>` shows its records. That is the project query, the surface
  scoping and the plugin's fetch, working together inside the shadow root.
- Zero console errors and zero page errors across all three routes.

**The PANE was checked by hand (2026-08-09) and works.** It is the half this harness cannot reach:
the button only appears for a cell whose session reports the `data` MCP group, which means a real
agent session — a shell cell, or a cell with no session, never shows it.

What was exercised: collections listed and opened inside the pane's own shadow root, navigation
staying in the pane (the app did not move to the full-screen browser), the portability strip
pressed and answering, and two cells on two projects each showing their own collections. The route
behind the strip answers `{"portable": true, "findings": []}` for mag2's `newsletters`, so
"Nothing to fix — it travels." is the reply it renders.

**How to repeat it**, since the next person will have to — and two details here are easy to state
wrongly, both corrected on review of this very page:

- **Where the group registration lives.** The launch form's `data` switch runs
  `claude mcp add -s local` (`server/infra/gui-mcp-registration.ts`), which writes
  **`~/.claude.json`, keyed by the directory** — NOT a `.mcp.json` in the folder. Deliberate:
  `local` scope keeps a personal tool-group choice out of a repo's diff. A hand-written project
  `.mcp.json` is a separate, also-supported route, and `registeredGuiMcpGroups` reads ANCESTOR
  project files and the local/user scopes too — so a cell in `/repo/packages/app` can inherit
  `data` from `/repo`. Adding a file in the leaf directory to "fix" a missing button is the wrong
  move.
- **The registration is read at SESSION START**, so flipping the switch takes a relaunch. That is
  the detail that makes the check look broken when it is not.
- **The workspace shortcut is not universal.** A workspace session gets every group automatically
  only for the agents `agentCarriesFullGuiMcp` admits — **Claude and Codex** (and their custom
  wrappers). Antigravity, Grok and Muse reach MCP through a config file or an installed plugin
  with no per-spawn `--mcp-config`, so in the workspace they still get only what their DIRECTORY
  registered (`common/guiMcpAgents.ts` says why, per agent).

The original lesson stands: server-side correctness was verified by curl and by specs at every
step, and none of that said the feature was reachable.

### 3.8 The Collections button only where the tools are (added 2026-08-09)

Not from this plan — asked for after the button was first pressed. A directory that never
registered the `data` MCP group has no `manageCollection`, so the pane is a door onto a room the
agent beside it cannot enter. The button is now HIDDEN there rather than disabled: a disabled
Canvas button explains a pane that would open empty and can be fixed by switching the group on,
while a directory with no collection tools is simply not a place where collections are a thing.

Answered from the SAME `/api/tools` reply as the canvas question (`hasCollectionsGroup`, beside
`hasCanvasGroup`), so the two buttons can never disagree about what a session has.

Two consequences to keep in mind:

- **A cell with no session gets no button** — no MCP client, no groups. That is the honest answer,
  but it also hides the pane on a launcher or command cell whose DIRECTORY does have collections.
- **The pane has no close control of its own**, so the button is its only way out. It therefore
  stays visible while the pane is open regardless of the groups. That clause lives in
  `CellChromeButtons` beside the `v-if` it guards (moved there on review), where `rightPane` is
  THAT cell's pane rather than the one the grid happens to be showing — remove it and an open pane
  is stranded for the life of the cell.

---

### 3.9 What this feature broke, and the shape of it (2026-08-09)

Two data-loss bugs, found because a user noticed their pinned favourites and their saved
directories had shrunk. Fixed in #1585; recorded here because the SHAPE is what the next person
needs, and one of them came straight out of this feature.

> **A list that lives in ONE shared file was replaced wholesale from whatever one client happened
> to hold.**

- **Pinned shortcuts, deleted by a project-scoped index.** `<workspace>/config/shortcuts.json` is
  workspace-global (shared with MulmoClaude), while the collection index that triggers
  `reconcileShortcuts` fetches a list scoped to the SURFACE's project. Reconciling one against the
  other says "every collection the workspace pinned is gone", and reconcile prunes and PERSISTS.
  Opening the Collections pane on a project deleted 21 pins, in both apps, silently. A
  project-scoped answer now reconciles nothing.
- **Saved directories, deleted by a client that had not loaded them.** `recordPreset` sent
  `presets.value` plus one entry, and that ref is empty until the first GET lands. A terminal
  launched during that GET persisted `[the one just launched]` — five directories became one, and
  four projects' collections stopped being served. Recording is now a one-entry mutation applied
  server-side under a cross-process lock.

**The rule that falls out of both:** "remember this" is an ADD-ONE, not a REPLACE-ALL. A client
that never holds the list cannot delete it. Anything here that reconciles, prunes or persists a
shared list against a view of it should be read with that in mind — including the next scoped
surface someone adds.

---

## 4. Decisions — the ones taken, and the two still open

1. **Does the root search walk UP? — DECIDED (2026-08-09): NO.** The root stays the session's cwd,
   exactly. **A collection belongs at the repository root**, which is where anyone would put one,
   so there is nothing to search for: a walk would exist to rescue a case that should not arise,
   at the price of a subdirectory cell quietly reading and writing the parent's data.

   This also keeps `(root, slug)` meaning what it says. Every id, token, bell and watcher in this
   feature is keyed on the root the request named; a root that was DERIVED by walking would be a
   second, implicit answer to "which project is this", and the whole arc above is about there
   being exactly one.

   The consequence, accepted: a cell opened in `~/proj/src` sees THAT directory's collections and
   only those — so it finds none unless someone put a `.claude/skills` there, which the decision
   above says is not where collections go. (It must also be a directory the server serves as a
   project; a directory that is not in `cwdPresets` has no collections here whatever it contains
   — see §3.4's listing.) If the empty pane ever reads as a fault rather than as a fact, the fix
   is a clearer message naming the repository root — a HINT, not a search.
2. **A user-scope dependency in a git-tracked collection (§11 L1) — DECIDED (2026-08-09), and
   IMPLEMENTED (2026-08-09, core 3.3.0).** The decision is that the answer is neither of the two
   this question offered: it must be PROHIBITED in the engine. `~` and a project are separate worlds, so standing in a
   project a collection under `~/.claude/skills` must not be reachable at all — not listed, and
   not resolvable by slug.

   **It no longer is.** `initCollectionsBackend` binds
   `userSkillsDir: (root) => isManagedWorkspace(root) ? ~/.claude/skills : null`, and core 3.3.0
   skips the user pass in BOTH `discoverCollections` and `loadCollection` when that is null. The
   managed workspace keeps user scope, exactly as MulmoClaude has it.
   `test/server/backends/collectionScopeIsolation.spec.ts` pins all three: merged in the
   workspace, absent from a project's listing, and a MISS on `loadCollection` by slug.

   Warning was the wrong shape because the check runs where someone asks, and the leak lives where
   resolution happens: `loadCollection` fell back to the user dir for ANY root, so `getSchema`,
   `getItems`, `putItems`, the detail route, a view token and the watcher all reached it whatever a
   listing showed. Hiding the entry would have been a label on a door that still opens.

   **Upstream shipped it**: `paths.userSkillsDir` is now
   `string | ((workspaceRoot) => string | null)` (core 3.3.0 — the string form is kept, deprecated,
   so a host floating on `^3.2.0` does not crash on install). MulmoClaude is one workspace and is
   unaffected.

   **The skill list is deliberately NOT brought into line**, which is the one thing here that
   changed on review of the original ask. `server/backends/remoteHost/skills.ts` still scans
   `~/.claude/skills` for every root, because `claude` itself does: a bundled skill mirrored there
   is runnable from any directory, and hiding it would break the Skill menu in every project. The
   consequence is that a user-scope dir holding both `SKILL.md` and `schema.json` now appears in a
   project's `listSkills` where it used to be subtracted — correctly, since the reason to subtract
   is that `listCollections` serves it, and for that root it no longer does. It is a skill there.

   Nothing had leaked before the fix, and that was luck rather than design: `~/.claude/skills` held
   12 skills and no `schema.json`, so there were no user-scope collections to merge. One would have
   appeared in every project the moment someone wrote one.
3. **`generateItemId()` is 4 random bytes.** Two machines creating records offline can collide;
   `primaryKey` avoids it. Widen upstream, or keep the guidance?
4. **A feed's ignored records — DECIDED (2026-08-09): warning, not blocker.** They are a cache
   re-fetched from a source the clone can reach, so the cost is a refresh rather than the data.
   Found by running the check over a real workspace, which ignores `feeds/` on purpose and
   therefore reported three feed collections as unclonable — a blocker nobody can act on is how a
   check stops being read.
5. **Does MulmoTerminal need a skill-bridge for the managed workspace at all?** It declares the
   staging path and mirrors nothing, so an agent authoring a collection skill in the workspace
   FROM MulmoTerminal writes a draft that never becomes active here.

---

## 5. How to work in this repo

- **The gate is `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.** Run all
  five before committing — a build failure was pushed once in this session because commit and
  build ran as separate commands and only the commit was checked.
- **The suite has a genuine flake** (one test failing under parallel load, passing in isolation and
  on re-run). Re-run before believing a single failure; say so rather than quietly re-running.
- **The review bots are worth taking seriously.** On these PRs they found real cross-project leaks
  that CI could not: a query route running against the workspace, a token payload publishing the
  user's home directory, a dataUrl that broke every suffix endpoint. When one is wrong, verify and
  say why with evidence — one claim about a published package was refuted by pulling the tarball.
- **Upstream first for anything shared.** `@mulmoclaude/core` drives MulmoClaude over the same
  workspace; `/api/*` naming authority is MulmoClaude's `src/config/apiRoutes.ts`. The chain is:
  core PR → publish → (republish dependent plugins if the bump crossed a MAJOR — a caret does not
  float across one) → MulmoTerminal bump. `../mulmoclaude/plans/chore-publish-plugins-core3.md`
  is the recipe.
