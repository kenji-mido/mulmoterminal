// Read-side backend for @mulmoclaude/collection-plugin. MulmoTerminal is a second
// live view over the SHARED workspace (CLAUDE_CWD, default ~/mulmoclaude) — it does
// not render a passed-in snapshot. The presentCollection chat card passes only a
// slug to CollectionView, which then calls the UI binding's fetchCollectionDetail()
// → GET /api/collections/:slug/detail here to load the live schema + records. So
// this engine wiring is required even for a read-only card.
//
// The path layout below MUST match MulmoClaude's exactly (see
// mulmoclaude/server/workspace/{skills,feeds}/paths.ts + skills-preset.ts) so
// discovery finds the same collection skills both apps share on disk.
//
// Read routes (list + detail), write routes (CRUD / actions / custom views), and
// the registry Discover routes all live here. The manageCollection MCP tool (the
// agent's data plane over the same engine) is a host tool — see
// server/infra/collection-tool.ts + the dispatch route in server/index.ts.
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import {
  buildWorkspaceOntology,
  configureCollectionHost,
  discoverCollections,
  loadCollection,
  enrichItems,
  readCustomViewHtml,
  validateRecordObject,
  recordFieldProblem,
  generateItemId,
  resolveCreateItemId,
  readSkillTemplate,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  promptPathsFor,
  toSummary,
  toDetail,
  validateCollectionRecords,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteCustomView,
  applyMutateAction,
  readOnlyRefusal,
  storeFor,
  type LoadedCollection,
  type RecordIssue,
} from "@mulmoclaude/core/collection/server";
import type { CollectionMutateAction } from "@mulmoclaude/core/collection";
// CollectionItem + fieldVisible live in the isomorphic core entry.
import { fieldVisible, COMPUTED_TYPES, type CollectionItem } from "@mulmoclaude/core/collection";
// Curated-registry engine (Discover tab): merged catalog fetch + bundle import.
import { listRegistry, importRegistry } from "@mulmoclaude/core/collection/registry/server";
// The rest of the custom-view surface (view-i18n, scoped image resolve, scoped
// mutate action), mounted at the bottom of mountCollectionRoutes with the
// helpers those routes share with the ones here.
import { mountCustomViewRoutes, viewActionRateLimit } from "./customViewRoutes.js";
import { clampLimit as clampViewLimit, clampOffset as clampViewOffset, normalizeFields, normalizeMutate } from "@mulmoclaude/core/remote-view";
import {
  buildRemoteViewFor,
  mutateRemoteViewFor,
  remoteViewFailureMessage,
  mutateRemoteViewFailureMessage,
  remoteViewItemsFor,
  remoteViewItemsFailureMessage,
} from "./remoteView.js";
import { mutateStatus, mutateWriteApplied } from "./mutateStatus.js";
// The 404 / 405 / 409 preamble those action routes share with the one here.
import { refuseReadOnlyCollection, resolveActionableRecord, resolveItemAction } from "./collectionActionGuards.js";
// Mobile custom-view builder — shared with the remote-host channel handlers so
// the desktop phone-frame preview renders the EXACT artifact the phone receives.
import { clampCapabilities, isCapability, mintViewToken, requireViewToken } from "./viewToken.js";
// The shared manageCollection binding — the query route reuses its queryItems
// action so a view can never do more than the agent's own data plane.
import { manageCollectionHandlerFor } from "../infra/collection-tool.js";
import { hostLogger } from "./hostLogger.js";
import { getCwdPresets } from "../config/config-routes.js";
import { isManagedWorkspace } from "./workspaceSetup.js";
import {
  errorStatus,
  initProjectRoots,
  projectId,
  projectRootKey,
  projectRootsConfigured,
  resolveProjectRoot,
  type ProjectScope,
} from "../infra/project-root.js";
import { isRecord } from "../../common/isRecord.js";
import { requestBody } from "../routes/requestBody.js";

// Console-backed logger matching the engine's CollectionLogger shape
// (prefix, message, optional structured data) — shared with the other engines'
// `configure*Host({ log })` bindings.
const log = hostLogger;

// Skill roots — the single source of truth for where skills live on disk, shared
// with the collection engine (below) AND the remote-host listSkills scanner
// (remoteHost/skills.ts) so both scan the exact same directories.
//
// The two do NOT apply the same SCOPE to them. The skill scanner reads the user dir for every
// root, because `claude` itself does — a bundled skill mirrored to `~/.claude/skills` is
// runnable from any directory. The collection engine reads it only for the managed workspace
// (see `userSkillsDir` in the host binding below). So in a project a dir holding both SKILL.md
// and schema.json is a skill and not a collection, which is precisely what it is there.
/** `~/.claude/skills` — user scope (read-only). */
export const userSkillsDir = (): string => path.join(os.homedir(), ".claude", "skills");
/** `<root>/.claude/skills` — project scope. */
export const projectSkillsDir = (root: string): string => path.join(root, ".claude", "skills");

/** Wire the collection engine to the shared workspace. Call once at boot, before
 *  any collection route is hit. The path layout mirrors MulmoClaude verbatim.
 *
 *  EXPLICIT-ROOT MODE: the host binds `workspaceRoot: null`, declaring that every call
 *  names its own root (`resolveProjectRoot`). Under that binding the engine's
 *  `getWorkspaceRoot()` THROWS rather than falling back, so a call site that forgets its
 *  root fails loudly here instead of silently reading whichever root happened to be bound —
 *  which on a host with one root per project is the difference between an error and another
 *  project's data. The workspace itself is bound through `initProjectRoots`, which is what
 *  every scope still resolves to today. */
export function initCollectionsBackend(deps: { workspace: string; knownProjects?: () => Array<{ label: string; path: string }> }): void {
  // The saved directories are the projects a request may name. Defaulted here rather than
  // passed from boot: a THUNK, because launching from a new directory records one and a list
  // captured at boot would refuse a project the launcher already shows. Specs override it.
  initProjectRoots({ workspace: deps.workspace, knownProjects: deps.knownProjects ?? getCwdPresets });
  configureCollectionHost({
    workspaceRoot: null,
    log,
    paths: {
      // ~/.claude/skills — user scope (read-only), and ONLY for the managed workspace.
      //
      // `~` and a project are separate worlds. A collection under `~/.claude/skills` is a
      // machine-global thing no clone of a repository can have, so standing in a project it must
      // not be reachable at all — not listed, and not resolvable by slug. Filtering the listing
      // alone would have been a label on a door that still opens: `loadCollection` is what
      // getSchema, getItems, putItems, the detail route, the view-token mint and the watcher all
      // go through, so a slug typed by the agent (or arriving in a URL) would still resolve into
      // the other world and write to its data dir.
      //
      // `null` is what core 3.3.0 added for exactly this — the same shape `skillsStagingDir`
      // above already had — and it skips the user pass in BOTH discovery and `loadCollection`,
      // so a user-only slug is a MISS for a project root rather than a quiet hop.
      //
      // The managed workspace keeps user scope: it IS the one workspace, exactly as MulmoClaude
      // binds it, so a project slug there still shadows a user one.
      userSkillsDir: (root) => (isManagedWorkspace(root) ? userSkillsDir() : null),
      // <root>/.claude/skills — project scope.
      projectSkillsDir,
      // <root>/feeds — feed registry root.
      feedsRoot: (root) => path.join(root, "feeds"),
      // <root>/data/skills — project-skills staging, and ONLY for the managed workspace.
      //
      // Staging exists to route around the `.claude/` permission gate: the agent writes drafts
      // to a plain data dir and a bridge mirrors the allowlisted files into `.claude/skills`.
      // A project folder has no such gate and MulmoTerminal runs no bridge, so a staging tree
      // there is not merely unused — the engine reads it FIRST for a project-scope collection,
      // so a stray file would shadow the committed skill, and it is a second copy of the
      // definition in a repo that is supposed to be self-contained.
      //
      // `null` is what core 3.1.0 added for exactly this: the engine then skips the staging
      // base rather than being handed a path that must never match.
      skillsStagingDir: (root) => (isManagedWorkspace(root) ? path.join(root, "data", "skills") : null),
      // Workspace-relative archive dir (removed collections move here).
      archiveDir: "archive",
      // <root>/config/collections-registries.json — extra Discover registries
      // (absent → official receptron/mulmoclaude-collections only).
      collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json"),
    },
    // MulmoClaude's launcher preset namespace.
    isPresetSlug: (slug) => slug.startsWith("mc-") && slug.length > "mc-".length,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Route params are caller-controlled — strip CR/LF so a crafted slug/id can't
// forge log lines.
function sanitizeLogValues(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value).replace(/[\r\n]/g, " ")]));
}

/** Wrap a route so an unexpected throw becomes a logged 500 rather than an
 *  unhandled rejection. `op` names the endpoint in the log line. */
function guarded<P extends Record<string, string>>(op: string, handler: RequestHandler<P>): RequestHandler<P> {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      log.warn("collections", `${op} failed`, { ...sanitizeLogValues(req.params), error: errorMessage(err) });
      // A request that named a project this server cannot serve is a CLIENT error; answering
      // 500 would read as "the server broke" for a typo in a query parameter.
      res.status(errorStatus(err)).json({ error: errorMessage(err) });
    }
  };
}

/** A request body usable as a record: a non-null, non-array object. */
function extractRecord(body: unknown): CollectionItem | null {
  return isRecord(body) ? body : null;
}

// A loaded collection, sans the null that `loadCollection` returns on a miss —
// derived here so the view-write helper doesn't need a fresh type import.
type ResolvedCollection = NonNullable<Awaited<ReturnType<typeof loadCollection>>>;

/** Load a collection, answering 404 when the slug is unknown. A null return means
 *  the response is already sent — the caller must return immediately. */
async function resolveCollection(res: Response, slug: string, scope: ProjectScope): Promise<ResolvedCollection | null> {
  const collection = await loadCollection(slug, scope);
  if (!collection) res.status(404).json({ error: `collection '${slug}' not found` });
  return collection;
}

/** Locate a declared custom view, answering 404 when it is absent. A null return
 *  means the response is already sent. */
function resolveView(res: Response, collection: ResolvedCollection, viewId: string) {
  const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
  if (!view) res.status(404).json({ error: `custom view '${viewId}' not found on collection '${collection.slug}'` });
  return view ?? null;
}

// The two store failures every record route maps identically, shared by the
// write and delete result unions.
type CommonStoreFailure = { kind: "invalid-id" | "path-escape"; itemId: string };

function isCommonStoreFailure(result: { kind: string; itemId: string }): result is CommonStoreFailure {
  return result.kind === "invalid-id" || result.kind === "path-escape";
}

function respondForStoreFailure(res: Response, slug: string, failure: CommonStoreFailure): void {
  if (failure.kind === "invalid-id") res.status(400).json({ error: `invalid item id: ${failure.itemId}` });
  else res.status(403).json({ error: `data directory for '${slug}' escapes the workspace` });
}

type CollectionWriteFn = NonNullable<ReturnType<typeof storeFor>["write"]>;

/** The collection's write function plus a validated body record, or null after
 *  sending the 405 (read-only) / 400 (bad body) response. Shared by the create and
 *  update routes, which each then call `write` their own way. */
function resolveWriteTarget(
  res: Response,
  collection: ResolvedCollection,
  body: unknown,
  scope: ProjectScope,
): { write: CollectionWriteFn; record: CollectionItem } | null {
  const write = storeFor(collection, scope).write;
  if (!write) {
    res.status(405).json({ error: readOnlyRefusal(collection.slug) });
    return null;
  }
  const record = extractRecord(body);
  if (!record) {
    res.status(400).json({ error: "request body must be a JSON object" });
    return null;
  }
  return { write, record };
}

/** First enforced-tier schema problem on a record about to be written by REST, or
 *  null. Runs core's own `recordFieldProblem` — the exact per-field check
 *  `validateRecordObject` runs, so the messages a REST client sees are identical
 *  to the ones view-data PUT and manageCollection putItems report — over the
 *  fields a WRITER can actually be held to:
 *
 *  - COMPUTED_TYPES are skipped, as core's own compiled validator skips them
 *    (they are never stored; the host derives them).
 *  - A `when`-HIDDEN field is skipped, which `validateRecordObject` does not do.
 *    That difference is deliberate and is why this loop exists rather than a
 *    plain `validateRecordObject` call: the collection editor treats a hidden
 *    field as never-missing (core's `validateOneField`: "a `when`-hidden field
 *    has no input the user can fill"), and its draft cannot populate one. A
 *    required-behind-`when` field would therefore make the editor's own valid
 *    save come back 400 (caught in review on #1497).
 *
 *  The primaryKey↔id identity check `validateRecordObject` opens with is not
 *  repeated: both callers build the record with `[primaryKey]: itemId` from a
 *  string id, so it holds by construction.
 *
 *  Core's `validateOneField` is the visibility-aware check, but it reads an
 *  editor DRAFT rather than a record, so it cannot be reused here. If core grows
 *  a visibility-aware record validator, this should become a call to it. */
function firstEnforcedProblem(record: CollectionItem, schema: ResolvedCollection["schema"]): string | null {
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (COMPUTED_TYPES.has(spec.type)) continue;
    if (!fieldVisible(spec, record)) continue;
    const problem = recordFieldProblem(key, spec, record[key], "enforced");
    if (problem) return problem;
  }
  return null;
}

/** Gate a record on its schema before it reaches the store, answering 400 with the
 *  problem when it fails. True means the request is already answered — stop.
 *
 *  The gate the other two write paths already have: view-data PUT (writeViewItem,
 *  below) and the agent's manageCollection putItems (core's putOneItem) both
 *  validate. REST create/update wrote straight through, so a client — a UI bug, a
 *  curl, a future remote writer — could persist a missing required field or an
 *  off-enum value that the detail route then reports back as `issues` with a Repair
 *  button, rather than the write being refused at the door (#1489).
 *
 *  The tier is core's `"enforced"`: required fields non-empty, enum membership.
 *  Deliberately NOT the `"strict"` tier, which exists to REPORT (a legacy record
 *  whose `number` field holds a string stays editable). */
function rejectedInvalidRecord(res: Response, collection: ResolvedCollection, record: CollectionItem): boolean {
  const problem = firstEnforcedProblem(record, collection.schema);
  if (!problem) return false;
  res.status(400).json({ error: problem });
  return true;
}

/** The action's skill template, or null after sending a 500. Shared by the per-record
 *  and collection-level action routes. */
async function readActionTemplateOr500(res: Response, collection: ResolvedCollection, action: { id: string; template: string }): Promise<string | null> {
  const template = await readSkillTemplate(collection.skillDir, action.template);
  if (template === null) {
    res.status(500).json({ error: `template '${action.template}' for action '${action.id}' could not be read` });
    return null;
  }
  return template;
}

// The write modes a custom view's PUT may request, matching the documented
// __MC_VIEW contract (@mulmoclaude/core help: custom-view.md).
type ViewWriteMode = "merge" | "upsert" | "create";
const VIEW_WRITE_MODES: readonly ViewWriteMode[] = ["merge", "upsert", "create"];

// Apply ONE per-record write for PUT /view-data. Returns the written id or a
// `{ rejected }` reason; kept out of the route handler so its loop stays flat
// (lint caps cognitive complexity). Behavior mirrors manageCollection's putItems:
//  - `merge`  — layer the partial onto the EXISTING record (update-only; a missing
//               id is rejected, never upserted into a half-populated record).
//  - `create` — insert-only; an existing id collides.
//  - `upsert` — write the record as given (create or overwrite); the default.
// Also enforces the singleton invariant (only the fixed id is writable) and gates
// every row on the schema (required fields, enum values, id↔primaryKey) so a bad
// row comes back in `rejected` with an actionable `problem` instead of persisting.
type ViewItemWriteResult = { writtenId: string } | { rejected: { id: string; problem: string } };

async function writeViewItem(collection: ResolvedCollection, raw: unknown, mode: ViewWriteMode, scope: ProjectScope): Promise<ViewItemWriteResult> {
  const record = extractRecord(raw);
  if (!record) return { rejected: { id: "", problem: "item must be a JSON object" } };
  const { singleton, primaryKey } = collection.schema;
  const declaredId = record[primaryKey];
  const itemId = typeof declaredId === "string" ? declaredId : "";
  if (!itemId) return { rejected: { id: "", problem: `missing primary key '${primaryKey}'` } };
  if (singleton && itemId !== singleton) {
    return { rejected: { id: itemId, problem: `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'` } };
  }
  // Reads and writes go through the collection's STORE (file, sqlite, …);
  // presence of `write` IS the writability check (core 0.25 storage seam).
  const store = storeFor(collection, scope);
  const { write } = store;
  if (!write) return { rejected: { id: itemId, problem: readOnlyRefusal(collection.slug) } };
  let toWrite: CollectionItem;
  if (mode === "merge") {
    const existing = await store.read(itemId);
    if (!existing) return { rejected: { id: itemId, problem: `item '${itemId}' not found — use "upsert" or "create" to add it` } };
    toWrite = { ...existing, ...record, [primaryKey]: itemId };
  } else {
    toWrite = { ...record, [primaryKey]: itemId };
  }
  const problem = validateRecordObject(toWrite, itemId, collection.schema);
  if (problem) return { rejected: { id: itemId, problem } };
  const result = await write(itemId, toWrite, { refuseOverwrite: mode === "create" });
  // Handle each WriteItemResult kind; the final case (`path-escape`) is the
  // fallthrough return so `result` narrows cleanly instead of hitting a `never`
  // default (mirrors manageCollection.putOneItem in MulmoClaude).
  if (result.kind === "ok") return { writtenId: result.itemId };
  if (result.kind === "invalid-id") return { rejected: { id: itemId, problem: `'${itemId}' is not a valid record id` } };
  if (result.kind === "conflict")
    return { rejected: { id: itemId, problem: `'${itemId}' already exists — mode "create" refuses overwrite; use "upsert" to update it` } };
  return { rejected: { id: itemId, problem: "write refused: the collection's data dir escapes the workspace" } };
}

/** A `fields` projection arrives as a CSV query (`?fields=title,photo`) or
 *  repeated params; hand `normalizeFields` an array either way. */
function csvParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

// ── Route handlers ──────────────────────────────────────────────────────────
// One named handler per endpoint (kept small + individually testable); the wiring
// list is mountCollectionRoutes at the bottom. All read module-level state
// (workspaceRoot) + the imported engine functions — no per-request closure.

// Discover tab: the merged curated-registry catalog (every configured registry's
// index.json, fetched + cached server-side).
const registryListHandler: RequestHandler = async (req, res) => {
  res.json(await listRegistry(resolveProjectRoot(req)));
};

// Discover tab: install a registry collection into the shared workspace.
const registryImportHandler: RequestHandler = async (req, res) => {
  if (!projectRootsConfigured()) {
    res.status(503).json({ error: "collections backend not initialized" });
    return;
  }
  const { workspaceRoot } = resolveProjectRoot(req);
  const body = requestBody(req.body);
  const author = typeof body.author === "string" ? body.author : "";
  const slug = typeof body.slug === "string" ? body.slug : "";
  const registry = typeof body.registry === "string" && body.registry ? body.registry : null;
  if (!author || !slug) {
    res.status(400).json({ error: "author and slug are required" });
    return;
  }
  const result = await importRegistry(author, slug, workspaceRoot, registry);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.response);
};

// Delete one custom view: drop it from the schema + unlink its HTML. Refuses
// user-scope / preset collections (read-only), like collection delete.
const viewDeleteHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const result = await deleteCustomView(collection, req.params.viewId, scope);
  if (result.kind !== "ok") {
    res.status(result.kind === "not-found" ? 404 : 403).json({ error: `view delete refused (${result.kind})` });
    return;
  }
  res.json({ deleted: true, viewId: result.viewId });
};

// Delete an entire collection (skill + records) after archiving a restorable
// copy. Only project-scope, non-preset collections are deletable; a refusal
// (preset / user-scope / unsafe path) comes back as 403 with the reason.
const collectionDeleteHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const result = await deleteCollection(collection, scope);
  if (result.kind !== "ok") {
    res.status(403).json({ error: deleteCollectionRefusalMessage(result) });
    return;
  }
  res.json({ deleted: true, slug: result.slug, archivePath: result.archivePath });
};

// List skill-backed collections for the index + toolbar.
const listHandler: RequestHandler = async (req, res) => {
  const collections = await discoverCollections(resolveProjectRoot(req));
  res.json({ collections: collections.map(toSummary) });
};

// Raw workspace-ontology entries (buildWorkspaceOntology — derived on demand,
// never stored); the /collections Map tab builds its graph from these with the
// shared `buildOntologyGraph` client-side. Port of MulmoClaude's
// GET /api/collections/ontology (mulmoclaude PR #2218).
const ontologyHandler: RequestHandler = async (req, res) => {
  res.json({ entries: await buildWorkspaceOntology(resolveProjectRoot(req)) });
};

// A collection's live schema + records by slug. Backs both the card's own load
// (CollectionView reads `status` for 404 → not-found) and ref/embed resolution.
const detailHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const items = await storeFor(collection, scope).list();
  // Best-effort validation: a malformed record is silently skipped at read
  // time, so surface the problems here too and let the view offer a Repair
  // button. Never let validation failure turn a successful detail into a 500.
  let issues: RecordIssue[] = [];
  try {
    issues = await validateCollectionRecords(collection, scope);
  } catch (err) {
    log.warn("collections", "detail validation skipped", { slug: collection.slug, error: errorMessage(err) });
  }
  // Omit `issues` entirely when everything is fine (the "absent when clean"
  // contract the view relies on).
  res.json({ collection: toDetail(collection), items, ...(issues.length > 0 ? { issues } : {}) });
};

// Both write handlers open the same way: find the collection, then find something to write
// with. Either step answers the request itself when it cannot — a 404 for an unknown slug, a
// 405 for a read-only store — so the caller's only job is to stop.
async function resolveWriteRequest(
  res: Response,
  slug: string,
  body: unknown,
  scope: ProjectScope,
): Promise<{ collection: ResolvedCollection; target: { write: CollectionWriteFn; record: CollectionItem } } | null> {
  const collection = await resolveCollection(res, slug, scope);
  if (!collection) return null;
  const target = resolveWriteTarget(res, collection, body, scope);
  if (!target) return null;
  return { collection, target };
}

// ── Record CRUD (Tier 1: interactive editing — e.g. checking a to-do item) ──
// Create a record. The id is the schema's primaryKey value from the body, or a
// generated one; a singleton collection pins every create to its fixed id.
const itemCreateHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const resolved = await resolveWriteRequest(res, req.params.slug, req.body, resolveProjectRoot(req));
  if (!resolved) return;
  const { collection, target } = resolved;
  const itemId = resolveCreateItemId(collection.schema, target.record) ?? generateItemId();
  const recordWithId: CollectionItem = { ...target.record, [collection.schema.primaryKey]: itemId };
  if (rejectedInvalidRecord(res, collection, recordWithId)) return;
  const result = await target.write(itemId, recordWithId, { refuseOverwrite: true });
  if (isCommonStoreFailure(result)) {
    respondForStoreFailure(res, collection.slug, result);
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: `item '${result.itemId}' already exists` });
    return;
  }
  res.json({ itemId: result.itemId, item: result.item });
};

// Update a record. The primaryKey is pinned to the URL itemId (the body can't
// smuggle a different id). Singletons only accept their one fixed id.
const itemUpdateHandler: RequestHandler<{ slug: string; itemId: string }> = async (req, res) => {
  const resolved = await resolveWriteRequest(res, req.params.slug, req.body, resolveProjectRoot(req));
  if (!resolved) return;
  const { collection, target } = resolved;
  const { singleton, primaryKey } = collection.schema;
  if (singleton && req.params.itemId !== singleton) {
    res.status(400).json({ error: `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'` });
    return;
  }
  const recordWithId: CollectionItem = { ...target.record, [primaryKey]: req.params.itemId };
  if (rejectedInvalidRecord(res, collection, recordWithId)) return;
  const result = await target.write(req.params.itemId, recordWithId);
  if (isCommonStoreFailure(result)) {
    respondForStoreFailure(res, collection.slug, result);
    return;
  }
  if (result.kind === "conflict") {
    res.status(500).json({ error: "unexpected conflict on update" });
    return;
  }
  res.json({ itemId: result.itemId, item: result.item });
};

// Delete a record.
const itemDeleteHandler: RequestHandler<{ slug: string; itemId: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const deleteStore = storeFor(collection, scope).delete;
  if (!deleteStore) {
    res.status(405).json({ error: readOnlyRefusal(collection.slug) });
    return;
  }
  const result = await deleteStore(req.params.itemId);
  if (isCommonStoreFailure(result)) {
    respondForStoreFailure(res, collection.slug, result);
    return;
  }
  if (result.kind === "not-found") {
    res.status(404).json({ error: `item '${result.itemId}' not found` });
    return;
  }
  res.json({ deleted: true, itemId: result.itemId });
};

// ── Actions (kind: "chat") — return a seed prompt + role; the frontend feeds it
//    to startChat, which spawns a visible chat. The records are edited by that
//    agent session directly (the intended model). ──

// Execute a `kind: "mutate"` action: validate the mini-form params, merge the
// resolved `set` over the record through the standard write gate, and answer
// with the written record so the client updates the open panel in place. The
// engine work lives in `applyMutateAction` (core); this maps its outcome to
// HTTP, mirroring MulmoClaude's host.
const respondForMutateAction = async (
  res: Response,
  collection: LoadedCollection,
  action: CollectionMutateAction,
  itemId: string,
  body: { params?: unknown } | undefined,
  scope: ProjectScope,
): Promise<void> => {
  const raw = body?.params;
  const params = isRecord(raw) ? raw : {};
  const outcome = await applyMutateAction(collection, action, itemId, params, scope);
  if (!outcome.ok) {
    // `itemId` is caller-controlled (a route param) — strip CR/LF so a crafted
    // id can't forge log lines.
    log.info("collections", "mutate action refused", {
      slug: collection.slug,
      itemId: itemId.replace(/[\r\n]/g, " "),
      actionId: action.id,
      status: outcome.status,
      problem: outcome.problem,
    });
    if (outcome.status === "not-found") res.status(404).json({ error: outcome.problem });
    else if (outcome.status === "require-unmet") res.status(409).json({ error: outcome.problem });
    else if (outcome.status === "write-refused") res.status(500).json({ error: outcome.problem });
    else res.status(400).json({ error: outcome.problem });
    return;
  }
  log.info("collections", "mutate action applied", { slug: collection.slug, itemId: itemId.replace(/[\r\n]/g, " "), actionId: action.id });
  res.json({ written: true, itemId, item: outcome.item });
};

// Per-record action (e.g. Repair / enrich this record).
const itemActionHandler: RequestHandler<{ slug: string; itemId: string; actionId: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const action = resolveItemAction(res, collection, req.params.actionId);
  if (!action) return;
  const record = await resolveActionableRecord(res, collection, action, req.params.itemId, scope);
  if (!record) return;
  // `kind: "mutate"` needs no template / seed / LLM — the host applies the
  // declarative write itself (`when` was just enforced above, same
  // visibility-is-authorization rule as the seeded kinds).
  if (action.kind === "mutate") {
    if (refuseReadOnlyCollection(res, collection)) return;
    await respondForMutateAction(res, collection, action, req.params.itemId, isRecord(req.body) ? req.body : undefined, scope);
    return;
  }
  const template = await readActionTemplateOr500(res, collection, action);
  if (template === null) return;
  // Pass the collection paths so the seed prompt carries the <collection_paths>
  // block — the skill template needs skillDir/dataPath to find its files.
  const paths = promptPathsFor(collection, scope.workspaceRoot);
  res.json({ prompt: buildActionSeedPrompt(record, template, paths), role: action.role });
};

// Collection-level action (operates over all records).
const collectionActionHandler: RequestHandler<{ slug: string; actionId: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const action = collection.schema.collectionActions?.find((entry) => entry.id === req.params.actionId);
  if (!action) {
    res.status(404).json({ error: `collection action '${req.params.actionId}' not found on collection '${collection.slug}'` });
    return;
  }
  // Schema validation already rejects mutate in `collectionActions` (no record
  // to write); this is the defensive twin that also narrows the type.
  if (action.kind === "mutate") {
    res.status(400).json({ error: `collection action '${action.id}' has kind "mutate" — mutate actions are record-level only` });
    return;
  }
  try {
    const template = await readActionTemplateOr500(res, collection, action);
    if (template === null) return;
    const allItems = await storeFor(collection, scope).list();
    const paths = promptPathsFor(collection, scope.workspaceRoot);
    res.json({ prompt: buildCollectionActionSeedPrompt(allItems, collection.schema, template, paths), role: action.role });
  } catch (err) {
    log.warn("collections", "collection action seed failed", { slug: collection.slug, actionId: req.params.actionId, error: errorMessage(err) });
    res.status(500).json({ error: errorMessage(err) });
  }
};

// ── Custom views (sandboxed-iframe HTML views, e.g. a poster gallery) ──
// A custom view is LLM-authored HTML rendered in a sandboxed iframe that fetches
// its records from view-data with a scoped token. Both tiers are wired: a GET
// read route and a PUT write route (the latter gated by a `write`-capable token).

// The custom view's raw HTML, read from the staging path via the package's
// path-safe reader. The frontend renders it sandboxed (token injected).
const viewFileHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const viewId = typeof req.query.id === "string" ? req.query.id : "";
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const view = resolveView(res, collection, viewId);
  if (!view) return;
  const html = await readCustomViewHtml(collection, view.file, scope);
  if (html === null) {
    res.status(404).json({ error: `view file '${view.file}' not found` });
    return;
  }
  // This is LLM-authored HTML. The frontend renders it sandboxed via a
  // fetch()→srcdoc iframe (not by navigating here), so harden the raw response
  // against DIRECT navigation: `sandbox` gives it an opaque origin (its scripts
  // can't reach the app origin's /api/*), and `nosniff` stops re-interpretation.
  // The iframe path is unaffected — a fetch() reads the body regardless of this
  // response-level CSP.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.type("text/html").send(html);
};

// Mint a scoped token for a custom view, clamped to what the view declared so a
// read-only view can never obtain a write token.
const viewTokenHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const { slug } = req.params;
  const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
  const viewId = typeof body.viewId === "string" ? body.viewId.trim() : "";
  if (!viewId) {
    res.status(400).json({ error: "`viewId` is required" });
    return;
  }
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, slug, scope);
  if (!collection) return;
  const view = resolveView(res, collection, viewId);
  if (!view) return;
  // The write tier is wired below (PUT /view-data), so grant exactly what the
  // view declared. `clampCapabilities` defaults the requested set to the declared
  // set, so a `["read"]` view still can never obtain a `write` token.
  // Filtered rather than asserted. The schema validator already rejects an unrecognised capability
  // (a collection declaring one fails to load at all), so this changes nothing today — but it is
  // the local code proving what it hands to the minter rather than declaring it.
  const granted = clampCapabilities(Array.isArray(view.capabilities) ? view.capabilities.filter(isCapability) : undefined, undefined);
  // The token carries the project; the URL stays clean. The bundled custom-view contract
  // builds its other endpoints by CONCATENATION (`dataUrl + "/query"`, `+ "/image?…"`), so a
  // trailing `?project=` here would land inside those suffixes and 401 every one of them.
  const minted = mintViewToken(slug, granted, projectId(scope.workspaceRoot));
  res.json({ token: minted.token, exp: minted.exp, dataUrl: `/api/collections/${encodeURIComponent(slug)}/view-data`, capabilities: granted });
};

// CORS for the view-data endpoint: the sandboxed iframe has an opaque origin, so
// its fetch is cross-origin and preflighted. `*` is safe — auth is the unguessable
// scoped token in the Authorization header (not a cookie), so no ambient-credential
// leak; an origin without the token just gets a 401.
const viewDataCors = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  next();
};

// Serve a mobile (`target: "mobile"`) custom view wrapped into its sandboxed
// srcdoc — the desktop phone-frame preview's data source. Same builder as the
// remote-host channel's `getRemoteView`, so the preview renders the exact
// artifact the phone receives (preview === phone).
const remoteViewHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const { slug } = req.params;
  const viewId = typeof req.query.id === "string" ? req.query.id : "";
  const locale = typeof req.query.locale === "string" ? req.query.locale : "";
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, slug, scope);
  if (!collection) return;
  const result = await buildRemoteViewFor(scope)(collection, viewId, locale);
  if (result.kind !== "ok") {
    const notFound = result.kind === "view-not-found" || result.kind === "file-missing";
    res.status(notFound ? 404 : 400).json({ error: remoteViewFailureMessage(result, slug) });
    return;
  }
  res.json({ view: result.view, srcdoc: result.srcdoc, bytes: result.bytes });
};

// Apply one update/delete on behalf of a writable mobile view — the desktop
// preview's write channel. Same builder + host-side policy as the channel's
// `mutateRemoteViewItem`, so a preview mutation runs the exact enforcement the
// phone will.

const remoteViewMutateHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
  const { slug, viewId } = req.params;
  const request = normalizeMutate(isRecord(req.body) ? req.body : {});
  if (!request) {
    res.status(400).json({ error: "invalid mutate request — expected { op: 'update'|'delete', id, patch? }" });
    return;
  }
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, slug, scope);
  if (!collection) return;
  const result = await mutateRemoteViewFor(scope)(collection, viewId, request);
  if (mutateWriteApplied(result)) {
    // The write applied; only its response blew the byte budget. Report success (not a 4xx
    // that reads as a failed edit and strands stale data) and tell the client to re-fetch.
    res.json({ op: request.op, id: request.id, applied: true, warning: mutateRemoteViewFailureMessage(result, slug) });
    return;
  }
  if (result.kind !== "ok") {
    res.status(mutateStatus(result.kind)).json({ error: mutateRemoteViewFailureMessage(result, slug) });
    return;
  }
  res.json(result.op === "delete" ? { op: "delete", id: result.id } : { op: "update", item: result.item });
};

// One page of a mobile view's records, with its declared image fields inlined
// as `data:` thumbnails — the desktop phone-frame preview's paging source. Same
// builder as the channel's getRemoteViewItems, so the preview pages the exact
// data (real thumbnails) the phone gets.
const remoteViewItemsHandler: RequestHandler<{ slug: string; viewId: string }> = async (req, res) => {
  const { slug, viewId } = req.params;
  const fields = normalizeFields(csvParam(req.query.fields));
  const request = { offset: clampViewOffset(req.query.offset), limit: clampViewLimit(req.query.limit), ...(fields ? { fields } : {}) };
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, slug, scope);
  if (!collection) return;
  const result = await remoteViewItemsFor(scope)(collection, viewId, request);
  if (result.kind !== "ok") {
    res.status(result.kind === "view-not-found" ? 404 : 400).json({ error: remoteViewItemsFailureMessage(result, slug) });
    return;
  }
  res.json({ page: result.page, inlined: result.inlined, omitted: result.omitted });
};

// The predicate the write-mode check needs: `VIEW_WRITE_MODES.includes()` only accepts a value
// already typed as a mode, which is what forced the assertion it replaces.
const isViewWriteMode = (value: unknown): value is ViewWriteMode => VIEW_WRITE_MODES.some((mode) => mode === value);

// Scoped read: the view's enriched records as `{ items }` — the shape custom views
// fetch from `window.__MC_VIEW.dataUrl`. Guarded by the view token only.
const viewDataGetHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  const items = await enrichItems(collection, await storeFor(collection, scope).list(), scope);
  res.json({ items });
};

// Scoped write: apply per-record updates from a custom view (e.g. the vocabulary
// flashcard's grade buttons). Requires a `write`-capable token. Body is
// `{ items: [...], mode?: "merge" | "upsert" | "create" }`, matching the documented
// __MC_VIEW contract; `mode` defaults to `upsert` (write the record as given). The
// response envelope is `{ written, rejected }` — `written` is the id of each stored
// record, `rejected` a `{ id, problem }` per row that failed — the shape views read.
const viewDataPutHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  const scope = resolveProjectRoot(req);
  const collection = await resolveCollection(res, req.params.slug, scope);
  if (!collection) return;
  if (refuseReadOnlyCollection(res, collection)) return;
  const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
  if (!Array.isArray(body.items)) {
    res.status(400).json({ error: "`items` must be an array" });
    return;
  }
  // Checked BEFORE it is typed. The assertion this replaces named `body.mode` a valid mode and
  // then asked whether it was one — the answer arrived after the claim.
  const mode = body.mode === undefined ? "upsert" : body.mode;
  if (!isViewWriteMode(mode)) {
    const modeList = VIEW_WRITE_MODES.map((m) => `"${m}"`).join(", ");
    res.status(400).json({ error: `\`mode\` must be one of ${modeList}` });
    return;
  }
  const written: string[] = [];
  const rejected: Array<{ id: string; problem: string }> = [];
  for (const raw of body.items) {
    const outcome = await writeViewItem(collection, raw, mode, scope);
    if ("writtenId" in outcome) written.push(outcome.writtenId);
    else rejected.push(outcome.rejected);
  }
  res.json({ written, rejected });
};

/** Per-slug in-flight cap for view-issued aggregation queries — each one
 *  can be a full-file DuckDB scan, so a runaway dashboard loop must not
 *  stack dozens of concurrent scans. Mirrors MulmoClaude's guard. */
const VIEW_QUERY_MAX_CONCURRENT = 4;
const inflightViewQueries = new Map<string, number>();
const viewQueryConcurrency = (req: Request<{ slug?: string }>, res: Response, next: NextFunction): void => {
  // Keyed by (root, slug): a slug is unique only within a root, so a shared key would let one
  // project's dashboard spend another project's budget.
  const slug = `${projectRootKey(req)}\u0000${req.params.slug ?? ""}`;
  const current = inflightViewQueries.get(slug) ?? 0;
  if (current >= VIEW_QUERY_MAX_CONCURRENT) {
    res.status(429).json({ error: "too many concurrent queries for this collection — retry shortly" });
    return;
  }
  inflightViewQueries.set(slug, current + 1);
  let released = false;
  res.once("close", () => {
    if (released) return;
    released = true;
    const now = inflightViewQueries.get(slug) ?? 1;
    if (now <= 1) inflightViewQueries.delete(slug);
    else inflightViewQueries.set(slug, now - 1);
  });
  next();
};

// Scoped aggregation: run a structured query (the DSL — never raw SQL) over
// the collection. Read capability only (the DSL is read-only by construction).
// Reuses the shared manageCollection handler so a view can never do more than
// the agent's own queryItems (same validation, same engines: dataSource → the
// whole-CSV DuckDB scan; file-backed → the enriched-JSONL path). Errors return
// a FIXED message — raw engine errors can carry host paths, and a scoped view
// is not a trusted audience for those.
const viewDataQueryHandler: RequestHandler<{ slug: string }> = async (req, res) => {
  try {
    const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
    // Bound to the root THIS request resolved. `requireViewToken` has already checked the
    // token against that same root, so running the query against any other one would hand a
    // project-scoped view another project's rows for a shared slug.
    const query = manageCollectionHandlerFor(resolveProjectRoot(req).workspaceRoot);
    const raw = await query({ action: "queryItems", slug: req.params.slug, query: body.query });
    try {
      res.json(JSON.parse(raw));
    } catch {
      res.status(400).json({ error: raw });
    }
  } catch (err) {
    log.warn("collections", "view-data query failed", { slug: req.params.slug.replace(/[\r\n]/g, " "), error: errorMessage(err) });
    res.status(500).json({ error: "collection query failed" });
  }
};

/** Mount the collection REST surface. The response SHAPES are MulmoClaude's, which is
 *  what the package's UI binding (fetchCollectionDetail / listCollections) expects — but
 *  three PATHS deliberately differ from it: list is `/list` (MulmoClaude: `GET
 *  /api/collections`), detail is `/:slug/detail` (`GET /api/collections/:slug`), and the
 *  registry lives under `/api/collections/registry/*` (`/api/collections-registry/*`).
 *  Reason and the standing decision: docs/mulmoclaude-parity.md. A new caller against THIS
 *  server uses the paths mounted below — `/api/collections/list`,
 *  `/api/collections/:slug/detail`, `/api/collections/registry/*` — never MulmoClaude's
 *  spelling and never a third one.
 *  One app.METHOD(path, handler) per endpoint — the handlers live above. */
export function mountCollectionRoutes(app: Express): void {
  // Registered before the ":slug" routes so "registry" is never captured as a slug.
  app.get("/api/collections/registry/list", guarded("registry list", registryListHandler));
  app.post("/api/collections/registry/import", guarded("registry import", registryImportHandler));

  app.delete("/api/collections/:slug/views/:viewId", guarded("view delete", viewDeleteHandler));
  app.delete("/api/collections/:slug", guarded("collection delete", collectionDeleteHandler));

  app.get("/api/collections/list", guarded("list", listHandler));
  app.get("/api/collections/ontology", guarded("ontology", ontologyHandler));
  app.get("/api/collections/:slug/detail", guarded("detail", detailHandler));

  app.post("/api/collections/:slug/items", guarded("item create", itemCreateHandler));
  app.put("/api/collections/:slug/items/:itemId", guarded("item update", itemUpdateHandler));
  app.delete("/api/collections/:slug/items/:itemId", guarded("item delete", itemDeleteHandler));

  app.post("/api/collections/:slug/items/:itemId/actions/:actionId", guarded("item action seed", itemActionHandler));
  app.post("/api/collections/:slug/actions/:actionId", guarded("collection action seed", collectionActionHandler));

  app.get("/api/collections/:slug/view-file", guarded("view-file read", viewFileHandler));
  app.get("/api/collections/:slug/remote-view", guarded("remote-view build", remoteViewHandler));
  app.post("/api/collections/:slug/remote-view/:viewId/mutate", guarded("remote-view mutate", remoteViewMutateHandler));
  app.get("/api/collections/:slug/remote-view/:viewId/items", guarded("remote-view items", remoteViewItemsHandler));

  app.post("/api/collections/:slug/view-token", guarded("view-token mint", viewTokenHandler));
  app.options("/api/collections/:slug/view-data", viewDataCors, (_req: Request, res: Response) => {
    res.status(204).end();
  });
  app.get("/api/collections/:slug/view-data", viewDataCors, requireViewToken("read"), guarded("view-data read", viewDataGetHandler));
  app.put("/api/collections/:slug/view-data", viewDataCors, requireViewToken("write"), guarded("view-data write", viewDataPutHandler));
  app.options("/api/collections/:slug/view-data/query", viewDataCors, (_req: Request, res: Response) => {
    res.status(204).end();
  });
  // Not `guarded` like its neighbours, on purpose: the handler catches its own
  // throw so it can answer a FIXED message. A raw engine error can carry host
  // paths, and `guarded` would put exactly that in the body for a scoped view.
  // `requireViewToken` runs BEFORE the concurrency cap, and the order is load-bearing: the
  // token is what names the project (the iframe's URLs carry none), so a cap keyed on the root
  // must run after the token has attached it — otherwise every project's views contend for the
  // workspace's bucket. It is also the cheaper order: an unauthorized request no longer spends
  // a slot before being refused.
  app.post("/api/collections/:slug/view-data/query", viewDataCors, viewActionRateLimit, requireViewToken("read"), viewQueryConcurrency, viewDataQueryHandler);

  // The rest of the custom-view surface (customViewRoutes.ts: the i18n dict, the
  // scoped image resolve, the scoped mutate action), handed the loader / view
  // lookup / mutate executor it shares with the routes above.
  mountCustomViewRoutes(app, {
    resolveCollection,
    resolveView,
    respondForMutateAction,
    guarded,
    cors: viewDataCors,
    queryConcurrency: viewQueryConcurrency,
  });
}
