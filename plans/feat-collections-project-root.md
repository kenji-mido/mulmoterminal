# Collections in any folder — implementation plan

2026-08-08. Context: [project-architecture.md](./project-architecture.md) (D4 — the four
per-project subsystems are one problem). Goal: a collection can live in ANY project
directory, not only the single shared workspace.

---

## 1. Summary — this is mostly a MulmoTerminal change, not a MulmoClaude one

The expectation going in was "mainly upstream work". **It is not.** The core engine in
`@mulmoclaude/core/collection/server` is **already root-parameterized end to end**: every
exported entry point takes an options object carrying `workspaceRoot`, and the process-wide
host binding is only the *fallback*.

```ts
// the pattern, repeated at every entry point in the engine
const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
```

**A project must also be self-contained** — create a collection in a git-managed folder, push,
pull on another machine, and it works. §11 checks that requirement against the engine and lists
what leaks. It mostly holds already; the leaks are enumerable and worth a check command.

So the work splits as:

| Side | Work |
|---|---|
| **MulmoClaude / core** | **3 small items** (§3). None of them block the read path |
| **MulmoTerminal** | **The bulk** (§4): resolve a root per request, thread it through every call, and re-key everything that is currently keyed by slug alone |

## 2. What was verified (2026-08-08, `../mulmoclaude` @ eadbf1f53)

Checked in `packages/core/src/collection/server/`:

- `discoverCollections(opts)` and `loadCollection(slug, opts)` — both take
  `DiscoveryOptions.workspaceRoot`, and derive `projectSkillsDir` / `feedsRoot` from it
- `io.ts` (4 sites), `sqliteStore.ts`, `csvStore.ts` (3 sites), `views.ts`, `validate.ts`,
  `delete.ts`, `ontology.ts`, `skillAssets.ts`, `manageTool.ts` — all use
  `opts.workspaceRoot ?? getWorkspaceRoot()`
- `storeFor(collection, opts)`, `enrichItems(collection, items, opts)`,
  `buildWorkspaceOntology(opts)`, `readCustomViewHtml(collection, viewFile, opts)`,
  `validateCollectionRecords(collection, opts)`, `deleteCollection(collection, opts)` —
  all carry the option
- `promptPathsFor(collection, workspaceRoot)` and `resolveDataDir(dataPath, rootPath)` take
  the root as a plain argument
- `isContainedInWorkspace()` is the ONLY unconditional use of the ambient root — and it has
  **zero callers**
- `importRegistry` already receives the root explicitly (MulmoTerminal passes it today)

**There is no un-overridable ambient use of the workspace root in the engine.**

On the MulmoTerminal side, only two call sites omit the root today:

- `server/backends/collections.ts:390` — `discoverCollections()`
- `server/backends/collections.ts:158` — `loadCollection(slug)`

…but they are reached from ~30 routes, so "two call sites" understates it (§4.2).

## 3. Upstream (MulmoClaude / `@mulmoclaude/core`)

All three are small, and **all three keep MulmoClaude's single-workspace behaviour identical**
— it never passes a root, so it never leaves the current path.

### U1. `CollectionChangePayload` must carry the root *(required — correctness)*

```ts
export interface CollectionChangePayload { slug: string; ids?: string[]; op?: "upsert" | "delete"; }
```

The live-update ping is keyed by **slug alone**. With two projects each owning a `tasks`
collection, a write in project A refreshes the open view of project B. Add an optional root
(or opaque scope key) and let the host publish per-root channels.

MulmoClaude passes nothing and behaves as today.

**The root on this payload is an absolute path, and it is server-internal.** The engine publishes
to the HOST, which fans out to subscribers; the value never crosses to the browser. That is a
different thing from the client-facing project id in §5, which is opaque precisely so host paths
stay out of the browser and out of logs. When re-keying channels by `(root, slug)` (§4.3), key the
SERVER-side map on the root and name the client-visible channel by the opaque id — publishing a
channel named after a filesystem path would leak exactly what §5 refuses to send.

### U2. A strict mode where there is NO ambient root *(strongly recommended — safety)*

This is the real hazard of the whole change. Today a forgotten `opts.workspaceRoot` silently
falls back to the shared workspace. In MulmoTerminal, with N projects, a missed option is not a
crash — it **reads or writes the wrong project's data, with no error anywhere**. That is the same
failure shape as the `/calendar/push` divergence: green tests, wrong behaviour, invisible.

Proposal: allow the host to declare that it always passes roots explicitly, e.g.
`configureCollectionHost({ workspaceRoot: null, … })`, after which `getWorkspaceRoot()` **throws**
instead of guessing. MulmoTerminal turns it on and the class of bug disappears at the seam.

Keep the existing re-binding guard (`re-binding to a different host throws`) exactly as it is —
we are not re-binding, we are passing arguments.

### U3. Remove or parameterize `isContainedInWorkspace()` *(hygiene)*

Zero callers, and it is precisely the helper a future contributor would reach for — at which
point containment is silently checked against the wrong root. Delete it, or make it take a root.

### U5. `skillsStagingDir` must be able to say "there is no staging here" *(required — see §6.5)*

`CollectionHost.paths.skillsStagingDir: (root) => string` cannot express "this root has no
staging tree", and the engine reads staging **first** for `source === "project"` collections
(`skillAssets.ts:55`). Widen it to `(root) => string | null` and skip the staging base when null.

MulmoClaude returns a string for its one workspace and is unaffected.

### Not upstream

- **Route shapes** — the collection HTTP routes are host-owned (MulmoTerminal mounts its own in
  `server/backends/collections.ts`). See §5 for why we still do not change the paths.
- **Multi-root discovery** — the merge policy is a host decision (§6).

## 4. MulmoTerminal

### 4.1. `resolveProjectRoot()` — one resolver, four subsystems

Per D4 this resolver is shared with accounting / wiki / resources later, so it does not belong
inside `collections.ts`. Put it in `server/` next to the session registry (it needs the
session→cwd map), and export the *type* of a resolved root from `common/` if the client ever
names one.

```ts
resolveProjectRoot(req) -> string   // an absolute root; the workspace is simply the default one
```

**Decided: the shared workspace is just another project** (see §6.4), so the resolver returns a
plain root with no `workspace | project` discriminator. Callers never branch on which one it is —
that is the whole point of the decision, and a `kind` field is how the special case would creep
back in.

Resolution order:

1. explicit project parameter on the request (§5), validated against the **known-projects list**
2. otherwise the session's cwd, when the request carries a session id
3. otherwise the shared workspace (today's behaviour)

**The root must never be free text from the client.** `resolveDataDir` only guarantees
containment *within the root it is given* — so the root itself is the trust boundary. A
client-supplied absolute path would turn every collections route into an arbitrary-directory
reader. Resolve through `cwdPresets` + live sessions and reject anything else.

### 4.2. Thread the root through the routes

`mountCollectionRoutes` has ~30 handlers. Each one resolves the root once and passes
`{ workspaceRoot: root }` into every engine call it makes — `discoverCollections`,
`loadCollection`, `storeFor`, `enrichItems`, `validateCollectionRecords`, `deleteCollection`,
`buildWorkspaceOntology`, `readCustomViewHtml`, `promptPathsFor`, the registry import, and
`manageCollectionHandler` (which already accepts `deps.workspaceRoot`).

Mechanical, but this is where U2 earns its keep: with strict mode on, a handler that forgets
fails loudly in dev instead of quietly reading the workspace.

### 4.3. Re-key everything currently keyed by slug alone

A slug is unique **within a root**, not globally. Every cache, token and channel keyed by slug
becomes a cross-project leak or a stale read:

- **view tokens** (`server/backends/viewToken.ts`) — a token minted for `tasks` in project A must
  not read `tasks` in project B. Bind the root into the token and check it on use. *(security)*
- **pub/sub channels** for collection changes — see U1
- **`server/session/tool-store.ts`** and any memoized discovery — key by `(root, slug)`
- the client's collection stores / route params — same

### 4.4. Client

The collections UI must know which project it is looking at, show it, and send it back. Given
D2 (Project = directory) the natural label is the project's `.mulmoterminal.json` `name` +
colour, which the grid already renders.

## 5. Wire shape — do not change the paths

MulmoClaude's `src/config/apiRoutes.ts` is the naming authority and has no project concept:

```text
/api/collections            /api/collections/:slug            /api/collections/:slug/items
/api/collections/ontology   /api/collections/:slug/items/:itemId/actions/:actionId   …
```

Inserting a segment (`/api/collections/:project/:slug`) forks all of them from the authority for
no functional gain. **Carry the project as an out-of-band parameter instead** — a query
parameter (or header) that is simply absent today:

```http
GET /api/collections?project=<id>
GET /api/collections/tasks/items?project=<id>
```

Absent → the shared workspace → byte-identical to current behaviour. The paths stay equal to
MulmoClaude's, so the two repos do not drift.

`<id>` is an **opaque id from the known-projects list**, not a path (§4.1) — it also keeps host
absolute paths out of the browser and out of logs.

## 6. Discovery and merge semantics — decide before coding

`discoverCollections` merges three roots today: feeds (`<root>/feeds`), user scope
(`~/.claude/skills`, read-only), project scope (`<root>/.claude/skills`), with
project > user > feed on slug collision.

With a project root, the questions are:

1. **Does user scope still merge in?** Recommend **yes** — a global collection should be usable
   in every project, and it is already read-only, so it cannot be written into the wrong place.
2. **Do feeds follow the project root or stay in the workspace?** Recommend **follow the root**
   for consistency; feed refresh is scheduled per root then.
3. **Does the shared workspace stay visible when a project is selected?** **No** —
   showing both is what makes "which `tasks` am I editing?" unanswerable. The workspace is
   reachable by selecting it, like any other project (§6.4).

None of these need upstream changes; they are the options the host passes.

### 6.5. Skill staging is a WORKSPACE mechanism and must not follow into project roots

The workspace does not let the agent write `.claude/skills/` directly. It writes drafts to
`data/skills/<slug>/`, and `@mulmoclaude/core/skill-bridge` mirrors a **fixed allowlist** —
`SKILL.md`, `schema.json`, `templates/<path>` — into `.claude/skills/<slug>/`. Everything else
(README, assets, arbitrary nesting) stays staging-side. The bridge exists because of the
`.claude/` permission gate, not because staging is a nicer layout.

**A regular project folder has no such gate: the agent writes `<project>/.claude/skills/<slug>/`
directly, and there must be no staging tree there.**

This is not just a preference — the engine actively prefers staging:

```ts
// skillAssets.ts:55 — a `source: "project"` collection reads staging FIRST
const bases = collection.source === "project"
  ? [path.join(skillsStagingDir(workspaceRoot), safeSlug), collection.skillDir]
  : [collection.skillDir];
```

A project root's collections are exactly `source: "project"`. So a stray
`<project>/data/skills/<slug>/` — copied from a workspace, or written by an agent that learned the
workspace convention — **silently shadows the committed skill**: two `schema.json` in one repo, and
the one that is not the committed one wins. It also breaks §11 (the clone would carry a second copy
of the definition, and which one is live depends on a directory nobody meant to commit).

**What to do**

- Upstream **U5**: let `skillsStagingDir` return `null`; the engine then uses `[collection.skillDir]`
  alone.
- In MulmoTerminal, return the staging path **only for the managed workspace**. The predicate
  already exists — `isManagedWorkspace()` in `server/backends/workspaceSetup.ts`, which is what
  gates workspace-only seeding today.
- Do **not** wire a skill-bridge for project roots. There is nothing to bridge.

**How this qualifies D7 (§6.4).** The workspace stays "just another project" *for root resolution* —
`resolveProjectRoot` still returns a plain root with no discriminator. What differs is not identity
but **whether the root sits behind the `.claude/` permission gate**, and that belongs to the
skill-WRITE path, not to the resolver. Keep the distinction there and it stays one branch in one
place instead of a `kind` field spreading through every caller.

**Note on MulmoTerminal today**: MT declares `skillsStagingDir` for the engine but wires **no
bridge** — there is no PostToolUse mirror here (that was the deferred PR5). So MT reads a staging
tree it never writes; the declaration exists so a workspace MulmoClaude staged into is read the same
way by both hosts. Whether MT needs the bridge for the workspace at all is §10.

### 6.4. The shared workspace is one project among many *(decided)*

For collections there is **no workspace special case**: `~/mulmoclaude` is a directory with
`.claude/skills` in it, exactly like any other project root. It stays the **default** (an absent
`?project=` resolves to it) purely for back-compat, not because it is a different kind of thing.

This *removes* work rather than adding it — no `kind` discriminator, no second code path.

**But the other subsystems are not migrated yet, and that asymmetry is visible.** Accounting,
wiki, feeds and the scheduler are still bound to that one workspace at boot (D4). So during the
transition `~/mulmoclaude` is "the project that those subsystems also happen to point at".

The rule that keeps this honest in the UI:

> **A subsystem that is still workspace-bound is shown only when the selected project IS the
> workspace — not shown empty, and never shown against another project's data.**

An empty Accounting panel in project "Q3-report" reads as "no books yet" when the truth is "this
subsystem does not follow projects yet". Hiding it says the right thing by saying nothing.

Migrating accounting (and later wiki) is the same resolver applied to another host adapter — a
separate change, deliberately not bundled here.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Silently reading/writing the wrong project** — the whole class | U2 strict mode; no ambient fallback in MulmoTerminal |
| **A view token crossing projects** | bind root into the token, verify on use (§4.3) |
| **Client-supplied root = arbitrary directory read** | resolve ids through the known-projects list only (§4.1) |
| **Live-update pings crossing projects** | U1 |
| Drift from MulmoClaude's API | paths unchanged; project rides as an optional param (§5) |
| A project directory with no `.claude/skills` | empty list, not an error — same as an empty workspace |
| **A stray `data/skills/<slug>/` in a project shadowing the committed skill** | U5 + return staging only for the managed workspace (§6.5) |

## 7b. The collection watcher is single-root, and it fails quietly

Found while reviewing the upstream PR (mulmoclaude#2838). Not a defect there — it was outside
that plan's scope — but it lands squarely on this one.

`@mulmoclaude/core/collection-watchers` keeps **one module-level `discoveryOpts`**
(`watcher.ts:117`), set once by `startCollectionWatchers()`. So the watcher can watch exactly
**one root per process**. MulmoTerminal runs it — `startCollectionCompletionWatchers()` in
`server/index.ts` drives the completion bells — and configures it with **no `discoveryOpts` at
all**.

Two consequences for this plan:

1. **The moment we bind explicit-root mode (phase 3), the watcher throws at startup.**
   `discoverCollections({})` with no ambient root is exactly the error U2 introduces. And the
   call site is `.catch`-ed, so it does not abort boot — it logs
   `[collection-watchers] failed to start — completion bells disabled` and the bells are simply
   gone. **A silent feature loss is the worst shape this could take**, so phase 3 must pass
   `discoveryOpts: { workspaceRoot }` explicitly, and a spec should pin that the watcher starts.
2. **Even then, only one root is watched.** Project collections get no completion bells and no
   live-update pings. Serving N roots needs either a watcher instance per root (an upstream
   change — the module singleton is the blocker) or a host-side multiplexer.

Not a blocker for phases 1-4; it is a phase-5 deliverable and should be decided before the
project selector ships, or "my project's collection never rings" becomes the first bug report.

**Upstream settled this contract in mulmoclaude#2838** (core 3.0.0). What MulmoTerminal must now do:

- **Pass a root at start.** `startCollectionWatchers({ discoveryOpts: { workspaceRoot } })`.
  Under explicit-root mode a call without one throws `COLLECTION_ROOT_REQUIRED`.
- **Switch projects with `await stopCollectionWatchers()` then start.** Starting a second root
  while one is running throws `WATCHER_ROOT_CONFLICT`; `stop()` waits out a boot in flight and a
  clock pass in flight, so the next start does not race the one it replaced. This is now a
  supported production path, not a test-only one.
- **Branch on `err.code`, not message text.** Both codes are exported. Our call site
  (`startCollectionCompletionWatchers`, fire-and-forget with `.catch`) otherwise lands both on
  one log line and we cannot tell "forgot the root" from "another project is running".
- **SUPERSEDED BY core 3.1.0 (shipped):** `startCollectionWatchers` mounts one generation PER
  ROOT concurrently, `WATCHER_ROOT_CONFLICT` is no longer thrown, and bell ids carry the root, so
  two projects owning one slug hold two distinct bells. MulmoTerminal wires it in
  `server/backends/collectionWatchers.ts` — see `HANDOFF-collections-projects.md` §3.1. The
  paragraph below is the 3.0.0 contract, kept for the reasoning behind the identity change:

- **Still one root at a time.** Concurrency was deliberately deferred: bell identity is
  `completionLegacyId(slug, itemId)` and `buildNavigateTarget(slug, itemId)`, a HOST-FACING
  contract carried through the notifier file we SHARE with MulmoClaude. Two roots owning one slug
  collide there, not just in a watcher map — so per-project bells are a cross-app identity change,
  not a re-key. Budget for that separately if phase 5 wants bells per project.

## 7c. The gap this design missed: a reference is still a bare slug

Found by trying to USE the feature rather than by reading the plan, which is the wrong way round
— it belonged here before any of it was built.

**A collection's identity became `(root, slug)`. Every reference that crosses a boundary still
carries `slug` alone.** Phases 3-5 scoped the read/write SURFACE — routes, tokens, caches — and
stopped there. Anything that names a collection from OUTSIDE that surface still resolves the
workspace, silently and by construction.

The boundaries, worst first:

**A. The agent's tool dispatch.** `POST /api/plugin/manageCollection` calls the
workspace-bound handler, so "create a collection in this folder" from a project cell creates it
in the workspace. This is the one that makes the feature unusable as intended, and it is the
cheapest to fix: the dispatch already carries the session id in a header (`broker.ts`), so
session → cwd → root is the resolver the accounting comment predicted.

**B. A collection action spawns its chat in the wrong directory.** `spawnBackgroundChat` always
spawns in `CLAUDE_CWD`, while the seed prompt's `<collection_paths>` are built from the request's
root. The agent is handed a project's paths and dropped in the workspace — the two disagree in a
way that reads as a broken template rather than a wrong cwd.

**C. Notification deep links.** ~~`buildNavigateTarget(slug, itemId)` yields
`/collections/<slug>` with no project, so a bell from a project collection opens the workspace's
collection of that slug.~~ **DONE.** core 3.1.0 made the identity change this paragraph called
for — `completionLegacyId` encodes the root, and the adapter receives it — and MulmoTerminal now
turns that root into an opaque project id on the link, the target and the card accent. See
`HANDOFF-collections-projects.md` §3.2, including the one parity asymmetry it leaves.

**D. Canvas cards.** `presentCollection` / `seedCollectionCanvas` render through the global
binding, which reads the ambient `activeProjectId` — set only while a Collections pane is open. A
card produced in a project cell reads whichever project is active when it renders, which may be
none. A card should carry the root it was made for.

**E. The phone.** The remote-host channel handlers are bound to `workspaceScope()`, so a project's
collections do not exist on the phone at all. Deliberate for now — but undocumented until here.

**F. Scheduled feed refresh.** The system task runs against the workspace, so a project's feeds
never refresh on their schedule; only a manual `/refresh?project=` does.

**G. Watchers** — one root per process (§7b).

**What to take from it.** The rule the design should have stated: *if a name crosses a process,
a session, a file or an app boundary, it needs the root beside it.* A slug is unique within a
root and nowhere else, and every item above is a place that assumption was left standing.

## 8. Phases

| # | Work | Where | Ships on its own? |
|---|---|---|---|
| 1 | U1 payload root + U2 strict mode + U3 cleanup, published | MulmoClaude / core | yes (no behaviour change there) |
| 2 | `resolveProjectRoot()` + known-projects validation | MulmoTerminal | **DONE** (the known-projects list is phase 5; a `project` parameter is refused, not ignored) |
| 3 | Thread root through all routes; turn strict mode on | MulmoTerminal | **DONE** — still workspace-only, but now explicit |
| 4 | Re-key tokens / caches / channels by `(root, slug)` | MulmoTerminal | **DONE** — tokens carry the root, the thumbnail cache and the query cap key on it; MT wires no collection change publisher, so there was no channel to re-key |
| 5 | `?project=` parameter + client surface | MulmoTerminal | **DONE.** Server: `?project=<opaque id>` + `GET /api/collection-projects`. Client: a **Collections pane** beside Canvas / Tools / Files, scoped to the CELL's directory — there is no picker, because a Project is a directory and the cell already names one |
| 6 | Merge-semantics decisions from §6 made real | MulmoTerminal | **DONE by construction** — user scope still merges (engine default), feeds follow the root (`feedsRoot(root)`), and the workspace is simply not the root when a project is named |
| 7 | Self-containment check (§11.4) | MulmoTerminal | yes — useful even before 5 |
| 8 | Watcher per root, or accept workspace-only bells (§7b) | MT + possibly upstream | decide before 5 ships |
| 9 | No skill staging outside the managed workspace (§6.5, needs U5) | upstream + MT | **DONE** — core 3.1.0 + MT #1578: staging is workspace-only and `schemaDocs` serves a root-appropriate authoring guide |
| **A** | Session-scope the agent's `manageCollection` dispatch (§7c A) | MT | **DONE** — reads `cwdForSession`, the same lookup presentDocument's relative paths use |
| B | Spawn a collection action's chat in the collection's root (§7c B) | MT | **DONE** in #1573's review round |
| C | Notification deep links carry the project (§7c C) | MT + cross-app | with 8 |
| D | Canvas cards carry the root they were made for (§7c D) | MT | **PARTLY DONE** (#1579): the canvas is a surface and scopes its cards to its session's project, with layer-based precedence so a browser covering it still wins. Per-CARD scope (`withCardScope`, core 3.1.0) waits on a `collection-plugin` release — the plugin still fetches by slug alone |
| E | The phone follows the session's project (§7c E) | MT | decide |
| F | Per-root scheduled feed refresh (§7c F) | MT | decide |

Phase 3 is worth shipping alone: it changes no behaviour but removes every implicit root, which
is what makes phase 5 safe.

## 9. Testing

- A spec that discovers and writes against **two `mkdtempSync` roots in one process** and asserts
  no bleed — this is the test the current architecture cannot express, and the one that pins it
- Strict mode on ⇒ any engine call without a root **throws** (guards against future regressions)
- A view token minted for root A is rejected for root B
- Absent `project` parameter ⇒ responses byte-identical to today (back-compat pin)

## 10. Open questions

1. ~~Is the shared workspace just "one more project"?~~ **Decided: yes** (§6.4). Accounting /
   wiki stay workspace-bound for now and are hidden for other projects.
2. Opaque project id: derived from `cwdPresets` index, or a hash of the path? (stability across
   restarts vs. leaking nothing)
3. Do we need per-root feed scheduling in phase 5, or can feeds stay workspace-only for now?
4. Does MulmoClaude want U2's strict mode for its own tests, or is it MulmoTerminal-only?
5. Should a user-scope dependency (L1) be a **warning or a refusal** for a collection in a git
   repo? Refusal is safer for clone parity and worse for the "global collection everywhere" case.
6. Should `generateItemId()` be widened upstream (32 bits → 128), or is `primaryKey` guidance
   enough?
7. Does MulmoTerminal need the skill-bridge for the managed workspace at all (§6.5)? It declares
   the staging path but mirrors nothing, so an agent authoring a collection skill in the workspace
   from MT writes a draft that never becomes active here.

## 11. Self-contained projects — clone parity

**Requirement: a collection created in a git-managed project, pushed and pulled on another
machine, must just work.** Nothing may live outside the project directory that the collection
needs in order to function.

### 11.1. What already holds (most of it)

The engine's existing containment rules are exactly the ones this requirement needs:

- **Everything is root-relative.** `resolveDataDir` **refuses absolute paths, `..` segments, and
  symlinks escaping the root** — so a schema literally cannot point at a machine-specific
  location. This is the property that makes clone parity achievable at all, and it is already
  enforced at discovery time and re-checked before each write.
- **On-disk layout travels whole**:
  ```
  <project>/.claude/skills/<slug>/schema.json   (+ SKILL.md, custom views)
  <project>/data/collections/<slug>/items/<itemId>.json
  ```
- **One file per record** (the `file` store). This is the git-friendly shape: two machines editing
  different records merge cleanly, and two machines editing the same record conflict on that one
  file rather than on the whole collection.
- **Project identity travels too** — `.mulmoterminal.json` (name, colour, icon) is in the repo, so
  the clone shows up as the same project on the other machine (D2).

### 11.2. What leaks — four, all enumerable

**L1. User-scope skills (`~/.claude/skills`) — the main leak.**
§6.1 merges user scope into discovery, which is right for usability and wrong for portability: a
project can end up *silently depending* on a machine-global collection, and the clone gets a
missing or different one. The dependency is invisible until someone else pulls.

**L2. SQLite storage — reachable, unused, and unmergeable.**

First, what it is: a collection schema declares one of **three storage kinds** —
`file` (the default: one JSON file per record under `data/collections/<slug>/items/`),
`csv` (read-only rows of an external `dataSource` file, queried through DuckDB), and
`sqlite` (**every record in a single SQLite database file**, one JSON record per row keyed by the
primaryKey, via `node:sqlite`).

**MulmoTerminal does not offer it, but does not block it either.** Nothing in the UI creates one
and no MulmoTerminal doc mentions it — it arrives with the shared engine: the installed
`@mulmoclaude/core@3.0.0` ships `sqliteStore`, and `storeFor()` dispatches on the schema's
storage kind, so a schema declaring sqlite (an agent can write one through `manageCollection`)
would work today.

Runtime availability is **not** the portability risk it first looked like: `node:sqlite` needs
Node >= 22.5 and **MulmoTerminal's own floor is Node >= 22.9**, so every supported MulmoTerminal
machine can load it. (The >= 20.12 floor in the engine's comment is MulmoClaude's, and only
matters if the same repo is opened there.)

What does not go away is git: **a single binary file cannot be merged.** Two machines editing the
same collection offline produce a conflict no one can resolve by hand — where the `file` store
would have merged cleanly per record. That is the reason to keep sqlite away from a
git-shared project, and it is about merge semantics, not about support.

**L3. CSV / `dataSource` collections.** Read-only, and queried through DuckDB — another runtime
dependency the clone must satisfy. The source file itself is fine: `resolveDataDir` already forces
it inside the root, so it travels.

**L4. `.gitignore`.** A `data/` or `data/collections/` ignore line — common, and often inherited
from a template — means the schema travels and **every record is silently missing**. The clone
opens the collection and sees zero rows, which reads as "empty collection", not "not committed".

### 11.3. Record ids across machines

- With a `primaryKey`, the id is **derived from the record** (`resolveCreateItemId`), so two
  machines creating the same logical record produce the **same filename** → git reports an
  add/add conflict. That is the correct, loud outcome.
- Without one, `generateItemId()` is **4 random bytes (32 bits)**. Two machines creating records
  offline can collide; at ~65k records in a collection the birthday odds stop being negligible.
  The failure is again a git conflict rather than silent corruption, but it is a sharp edge.

**Recommend: declare a `primaryKey` on any collection meant to be shared.** Widening the generated
id is an optional upstream nicety, not a blocker.

### 11.4. Deliverable: a self-containment check

The leaks above are all statically detectable. One function, surfaced at collection-creation time
and as a command:

> **"Would this collection survive a clone?"** — reports: user-scope dependencies (L1), a sqlite
> store in a git repo (L2, unmergeable), a csv/DuckDB runtime requirement (L3), a data dir
> excluded by `.gitignore` (L4), a missing `primaryKey` on a collection in a git repo (11.3).

This is cheap (no new storage, no upstream change) and it is the difference between the guarantee
holding and it appearing to hold until someone else pulls.

### 11.5. Consequences for the rest of this plan

- **Prefer the `file` store for project collections** — it is already the default, so this is
  mostly about the check warning when a schema opts into sqlite inside a git repo (unmergeable),
  not about changing behaviour
- **Commit the data directory.** MulmoTerminal should not write a `.gitignore` that excludes it,
  and the check flags an inherited one (L4)
- **The project id from §5 must never be written into a committed file.** It resolves to a local
  absolute path and is meaningless on another machine — it is a request parameter, not identity
- The auto-commit idea in [project-architecture.md §7-4](./project-architecture.md) lands here
  naturally: one project = one repo = collection history for free
