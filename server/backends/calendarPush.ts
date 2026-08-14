// Push a collection's records to the Google calendar its schema declares — the opposite
// direction from the feeds Refresh route next door, and deliberately a separate route: which
// way the data moved must never be ambiguous, and this direction writes to a calendar other
// people may read.
//
// A thin host adapter, like feeds.ts: @mulmoclaude/core/google owns the diffing, the shadow
// state and the Calendar writes (`pushCalendarForCollection`), and its deps default to the
// live ones, so the host supplies only the workspace and the wire shape. The Google host
// itself is configured once at boot by initGoogleBackend().
//
// The path and the gates mirror MulmoClaude's own calendar-push route
// (server/api/routes/collections.ts) — same plugin, same shared workspace, so the two hosts
// must not answer it differently.
//
//   POST /api/collections/:slug/calendar-push   →  CollectionPushResult
import type { Express, Request, Response } from "express";
import { pushCalendarForCollection } from "@mulmoclaude/core/google";
import { loadCollection } from "@mulmoclaude/core/collection/server";
import { errorStatus, resolveProjectRoot, type ProjectScope } from "../infra/project-root.js";
import { toCollectionPushResult } from "./calendarPushResult.js";
import { hostLogger } from "./hostLogger.js";

/** Injectable so the route's gates are testable without a workspace on disk or a live
 *  Google grant — the same shape `mountGoogleRoutes` uses for the same reason. Which
 *  failure is an HTTP status and which is a field on a 200 is this route's whole job, so
 *  it must not be reachable only through a real push. */
export interface CalendarPushRouteDeps {
  /** Existence only — the engine's own lookup is calendar-scoped and so cannot tell a
   *  missing collection from one that simply declares no calendar. Narrowed to a presence
   *  check: a full `LoadedCollection` is a Zod-derived giant, and a route that needs one
   *  built to be tested is a route nobody tests. `object` rather than `unknown` because
   *  `unknown | null` collapses to `unknown`, which would drop "or null" from the contract
   *  the route reads. `loadCollection` satisfies this. */
  findCollection: (slug: string, scope: ProjectScope) => Promise<object | null>;
  push: typeof pushCalendarForCollection;
  /** The root this request runs against. ONE source for it: the engine lookup and the push
   *  must agree, and a second reader is how they drift. Read per REQUEST, not at mount — the
   *  routes go up before the collection host is configured, and (since core 3.0.0) that host
   *  has no ambient root to read later either. */
  scope: (req: Request) => ProjectScope;
}

const liveDeps: CalendarPushRouteDeps = {
  findCollection: loadCollection,
  push: pushCalendarForCollection,
  scope: resolveProjectRoot,
};

/** Mount POST /api/collections/:slug/calendar-push — backs the collection view's Push
 *  button (collectionUi.pushCalendarCollection). */
export function mountCalendarPushRoutes(app: Express, deps: CalendarPushRouteDeps = liveDeps): void {
  app.post("/api/collections/:slug/calendar-push", async (req: Request<{ slug: string }>, res: Response) => {
    const { slug } = req.params;
    try {
      // A slug that names nothing is the one genuine 404 here: there is no collection to
      // report a push result for, and the view distinguishes 404 from a generic failure.
      const scope = deps.scope(req);
      if (!(await deps.findCollection(slug, scope))) {
        res.status(404).json({ error: `collection '${slug}' not found` });
        return;
      }
      // Everything else — including "declares no calendar" — is a push refusal, and refusals
      // ride a 200 with the reason in `errors`. The engine's own lookup is calendar-only, so
      // an undeclared collection comes back as `not-a-calendar` without a gate here.
      //
      // DIVERGENCE from MulmoClaude, which 400s this case. Its `apiPost` extracts `{error}`
      // from a non-2xx body, so a 400 still reaches the user as a sentence; our `fetchJson`
      // reports the bare `HTTP 400` and drops the body, which would turn a fixable setup
      // problem into a page-level "HTTP 400" beside no explanation at all. Reunifying the
      // two means teaching `fetchJson` to read the body — tracked separately.
      const body = toCollectionPushResult(await deps.push(slug, scope.workspaceRoot));
      hostLogger.info("calendar-push", "pushed via collection route", {
        slug,
        created: body.created,
        updated: body.updated,
        conflicts: body.conflicts,
        errors: body.errors.length,
      });
      res.json(body);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      hostLogger.warn("calendar-push", "push threw", { slug, error });
      // A request naming a project this server cannot serve is a client error, not a failure
      // of the push — `errorStatus` keeps a query-parameter typo out of the 500 bucket.
      res.status(errorStatus(err)).json({ error });
    }
  });
}
