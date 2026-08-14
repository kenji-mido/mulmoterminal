// The guards both record-level action routes run before doing any work: the
// parent-side POST /:slug/items/:itemId/actions/:actionId (collections.ts) and
// the token-scoped POST /:slug/view-data/actions/:actionId (customViewRoutes.ts).
// Same destination, so the same 404 / 405 / 409 — and each answer is part of the
// API contract MulmoClaude's host shares, where the equivalent is `findActionOr404`.
//
// A third module rather than either file: customViewRoutes.ts must not import
// collections.ts (the reverse edge exists, which is why its helpers are handed in
// at mount time). This one imports only core, so neither direction cycles.
import type { Response } from "express";
import { collectionWritable, readOnlyRefusal, storeFor, type LoadedCollection } from "@mulmoclaude/core/collection/server";
import { actionVisible, type ActionWithWhen, type CollectionAction, type CollectionItem } from "@mulmoclaude/core/collection";
import type { ProjectScope } from "../infra/project-root.js";

// The action's state gate, rebuilt so core's exact-optional parameter accepts it: the schema
// parse yields a `when: undefined` / `require: undefined` KEY, which that type rejects.
//
// BOTH names are forwarded. They are the same gate under two spellings — `when` on the seeded
// kinds, `require` on mutate — and this call is the authorization check, so dropping either
// would make that kind's actions unconditionally runnable by a crafted request.
export const visibilityGate = (action: CollectionAction): ActionWithWhen => ({
  ...("when" in action && action.when ? { when: action.when } : {}),
  ...("require" in action && action.require ? { require: action.require } : {}),
});

/** Find a record-level action by id, answering 404 when the collection declares
 *  no such action. A null return means the response is already sent. */
export const resolveItemAction = (res: Response, collection: LoadedCollection, actionId: string): CollectionAction | null => {
  const action = collection.schema.actions?.find((entry) => entry.id === actionId);
  if (!action) {
    res.status(404).json({ error: `action '${actionId}' not found on collection '${collection.slug}'` });
    return null;
  }
  return action;
};

/** True once a 405 has been sent because the collection is read-only. Schema
 *  validation already rejects mutate actions on a dataSource collection; this is
 *  the defensive server-side twin both routes carry. */
export const refuseReadOnlyCollection = (res: Response, collection: LoadedCollection): boolean => {
  if (collectionWritable(collection)) return false;
  res.status(405).json({ error: readOnlyRefusal(collection.slug) });
  return true;
};

/** The record an action is about to run against, answering 404 when it is absent
 *  and 409 when the action's state gate rejects it. A null return means the
 *  response is already sent.
 *
 *  The gate is the authorization rule, not a display hint: the client hides
 *  out-of-state buttons, but a stale or crafted request could still target one. */
export const resolveActionableRecord = async (
  res: Response,
  collection: LoadedCollection,
  action: CollectionAction,
  itemId: string,
  scope: ProjectScope,
): Promise<CollectionItem | null> => {
  const record = await storeFor(collection, scope).read(itemId);
  if (!record) {
    res.status(404).json({ error: `item '${itemId}' not found` });
    return null;
  }
  if (!actionVisible(visibilityGate(action), record)) {
    res.status(409).json({ error: `action '${action.id}' is not available for item '${itemId}' in its current state` });
    return null;
  }
  return record;
};
