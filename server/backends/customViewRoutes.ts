// The custom-view routes a view needs beyond reading its records (#1490): its
// translations (parent-side), and — under its scoped token — resolving one image
// and pressing one DECLARED mutate action. All three are ports of MulmoClaude's
// host routes at the same paths, because core's bundled custom-view doc (served
// here through manageCollection's schemaDocs) tells collection authors they
// exist: a view written on one host has to work on the other.
//
// They live outside collections.ts only because that file is at its line budget;
// the helpers they need are handed in at mount time rather than imported back,
// so there is no cycle between the two modules.
import type { Express, Request, RequestHandler, Response } from "express";
import { clampImageMaxEdge } from "@mulmoclaude/core/remote-view";
import { readCustomViewI18n, storeFor, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import type { CollectionItem, CollectionMutateAction } from "@mulmoclaude/core/collection";
// The 404 / 405 / 409 preamble this action route shares with the parent-side one.
import { refuseReadOnlyCollection, resolveActionableRecord, resolveItemAction } from "./collectionActionGuards.js";
// The same thumbnail resolver the mobile view's image inlining uses, so a desktop
// view's <img> and the phone's inlined one are the same bytes.
import { thumbnailResolverFor } from "./thumbnailStore.js";
import { makeViewActionRateLimiter, ONE_MINUTE_MS, VIEW_ACTION_RATE_LIMIT_PER_MINUTE, VIEW_IMAGE_RATE_LIMIT_PER_MINUTE } from "./viewRateLimit.js";
import { requireViewToken } from "./viewToken.js";
import { resolveProjectRoot, type ProjectScope } from "../infra/project-root.js";
import { hostLogger } from "./hostLogger.js";
import { isRecord } from "../../common/isRecord.js";

const log = hostLogger;

/** What these routes need from the collections backend: its 404-answering loader,
 *  its mutate executor, and the two middlewares the whole view-data family shares. */
export interface CustomViewRouteDeps {
  /** Load a collection, answering 404 itself; null means the response was sent. */
  resolveCollection: (res: Response, slug: string, scope: ProjectScope) => Promise<LoadedCollection | null>;
  /** Locate a declared custom view, answering 404 itself; null means sent. */
  resolveView: (res: Response, collection: LoadedCollection, viewId: string) => { i18n?: string | undefined } | null;
  /** Apply a mutate action and answer with the written record (or its refusal). */
  respondForMutateAction: (
    res: Response,
    collection: LoadedCollection,
    action: CollectionMutateAction,
    itemId: string,
    body: { params?: unknown } | undefined,
    scope: ProjectScope,
  ) => Promise<void>;
  /** Wrap a handler so a throw becomes a logged 500. */
  guarded: <P extends Record<string, string>>(op: string, handler: RequestHandler<P>) => RequestHandler<P>;
  /** `Access-Control-*` for the opaque-origin iframe's preflighted fetch. */
  cors: RequestHandler;
  /** Per-slug in-flight cap shared with /query — both are full record scans. */
  queryConcurrency: RequestHandler;
}

/** True when `relPath` is a CURRENT value of one of the schema's `image`-type
 *  fields (top-level only, matching the mobile view's `inlineFields` rule) across
 *  `items`. This is the authorization rule for the image route: a scoped view
 *  token may resolve exactly these paths and nothing else, never an arbitrary
 *  workspace file. Early-exit scan; exported for the spec. */
export function isAuthorizedImagePath(schema: LoadedCollection["schema"], items: CollectionItem[], relPath: string): boolean {
  const imageFields = Object.entries(schema.fields)
    .filter(([, spec]) => spec.type === "image")
    .map(([name]) => name);
  if (imageFields.length === 0 || relPath.length === 0) return false;
  return items.some((item) => imageFields.some((field) => item[field] === relPath));
}

// Translation dict for ONE custom view, locale-filtered server-side. The client
// passes its active app locale; the host returns only that locale's strings
// (fallback "en", then {}). The view never sees other locales' strings — the
// host is the picker, the iframe is the consumer. Behind the same guard as the
// rest of the parent-side routes (not the view token): the parent fetches it
// and passes the dict into the srcdoc bootstrap, so the iframe never calls here.
//
// `{ locale: "", dict: {} }` when the view declares no `i18n` or the file is
// absent / malformed — the iframe's `__MC_VIEW.t(key)` then echoes the key, so
// an i18n-less view keeps working unchanged. Same contract as MulmoClaude's
// `viewI18n` route, which is what core's bundled custom-view docs (served here
// through schemaDocs) tell collection authors to expect.
const makeI18nHandler =
  (deps: CustomViewRouteDeps): RequestHandler<{ slug: string }> =>
  async (req, res) => {
    const viewId = typeof req.query.id === "string" ? req.query.id : "";
    const locale = typeof req.query.locale === "string" ? req.query.locale : "";
    const i18nScope = resolveProjectRoot(req);
    const collection = await deps.resolveCollection(res, req.params.slug, i18nScope);
    if (!collection) return;
    const view = deps.resolveView(res, collection, viewId);
    if (!view) return;
    if (!view.i18n) {
      // The documented "no i18n" shape, so the client needs no special case.
      res.json({ locale: "", dict: {} });
      return;
    }
    res.json(await readCustomViewI18n(collection, view.i18n, locale, i18nScope));
  };

// Scoped image read: resolve one record-referenced image path into a downscaled
// `data:` thumbnail (same resolver + clamps as the mobile view's imageFields
// inlining). The record scan doubles as the authorization check. A sandboxed view
// cannot attach its token to an `<img>`, so the JSON `{ dataUrl }` shape
// (fetch → img.src) is the contract the custom-view doc documents.
const makeImageHandler =
  (deps: CustomViewRouteDeps): RequestHandler<{ slug: string }> =>
  async (req, res) => {
    const scope = resolveProjectRoot(req);
    const collection = await deps.resolveCollection(res, req.params.slug, scope);
    if (!collection) return;
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (relPath.length === 0) {
      res.status(400).json({ error: "pass `path` — an image field's workspace-relative value" });
      return;
    }
    try {
      const items = await storeFor(collection, scope).list();
      if (!isAuthorizedImagePath(collection.schema, items, relPath)) {
        res.status(404).json({ error: "path is not a current value of this collection's image fields" });
        return;
      }
      const dataUrl = await thumbnailResolverFor(scope)(relPath, clampImageMaxEdge(req.query.maxEdge));
      if (dataUrl === null) {
        res.status(404).json({ error: "image could not be resolved" });
        return;
      }
      res.json({ path: relPath, dataUrl });
    } catch (err) {
      // The token holder gets a FIXED message — a raw resolver error can carry
      // host paths, and a scoped view is not a trusted audience for those.
      log.warn("collections", "view-data image failed", { slug: collection.slug, error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "image resolve failed" });
    }
  };

// Token-scoped mutate-action invocation: lets a `write`-capable custom view press
// a DECLARED mutate button instead of re-encoding the transition as a hand-rolled
// PUT /view-data (which would skip `require` and duplicate the `set` logic into
// the view's HTML). Mutate kind ONLY — a view token must never be able to start
// LLM work, so chat/agent actions stay on the parent-side action route.
const makeActionHandler =
  (deps: CustomViewRouteDeps): RequestHandler<{ slug: string; actionId: string }> =>
  async (req, res) => {
    const mutateScope = resolveProjectRoot(req);
    const collection = await deps.resolveCollection(res, req.params.slug, mutateScope);
    if (!collection) return;
    const action = resolveItemAction(res, collection, req.params.actionId);
    if (!action) return;
    if (action.kind !== "mutate") {
      res.status(403).json({ error: `action '${action.id}' has kind "${action.kind}" — view tokens can only invoke "mutate" actions` });
      return;
    }
    if (refuseReadOnlyCollection(res, collection)) return;
    const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      res.status(400).json({ error: "`itemId` is required (the record's primary-key value)" });
      return;
    }
    if (!(await resolveActionableRecord(res, collection, action, itemId, mutateScope))) return;
    await deps.respondForMutateAction(res, collection, action, itemId, body, mutateScope);
  };

// Per-minute budgets, keyed by IP + slug. Two buckets on purpose: a gallery's
// first paint is legitimately dozens of image fetches, which would exhaust the
// action budget on its own.
const imageRateLimit = makeViewActionRateLimiter(VIEW_IMAGE_RATE_LIMIT_PER_MINUTE, ONE_MINUTE_MS);
const actionRateLimit = makeViewActionRateLimiter(VIEW_ACTION_RATE_LIMIT_PER_MINUTE, ONE_MINUTE_MS);

/** Mount `GET …/view-i18n`, `GET …/view-data/image` and
 *  `POST …/view-data/actions/:actionId` — the last two with the preflight the
 *  sandboxed iframe's cross-origin fetch needs. */
export function mountCustomViewRoutes(app: Express, deps: CustomViewRouteDeps): void {
  const preflight = (_req: Request, res: Response): void => {
    res.status(204).end();
  };

  // Parent-side (no view token): the app fetches the dict and passes it into the
  // srcdoc bootstrap, so the iframe never calls this itself.
  app.get("/api/collections/:slug/view-i18n", deps.guarded("view-i18n read", makeI18nHandler(deps)));

  app.options("/api/collections/:slug/view-data/image", deps.cors, preflight);
  // `queryConcurrency` (4 in flight per slug, shared with /query) is deliberate,
  // and matching MulmoClaude here is not incidental: core's custom-view doc — the
  // one this app serves to the agent — states the cap, tells authors never to
  // `Promise.all` over every record, and ships a worker-pool + 429-retry snippet
  // to obey it. A view that fires N parallel fetches gets 429s on BOTH hosts, by
  // design; raising the cap here would make a view that only works on
  // MulmoTerminal look correct. The high per-minute image budget is the other
  // axis — it exists so a throttled pool of 3 isn't starved over a full gallery.
  app.get(
    "/api/collections/:slug/view-data/image",
    deps.cors,
    imageRateLimit,
    // Token first, cap second — the token is what names the project, and a cap keyed on the
    // root before it is attached buckets every project into the workspace's. Same order as
    // /view-data/query, for the same reason.
    requireViewToken("read"),
    deps.queryConcurrency,
    deps.guarded("view-data image", makeImageHandler(deps)),
  );

  app.options("/api/collections/:slug/view-data/actions/:actionId", deps.cors, preflight);
  app.post(
    "/api/collections/:slug/view-data/actions/:actionId",
    deps.cors,
    actionRateLimit,
    requireViewToken("write"),
    deps.guarded("view-data action", makeActionHandler(deps)),
  );
}

/** The action/query budget, exported so collections.ts can put `/query` on the
 *  same bucket its MulmoClaude counterpart uses. */
export const viewActionRateLimit = actionRateLimit;
