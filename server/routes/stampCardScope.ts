// Stamping the project onto a collection card, at the moment it is published.
//
// A card's payload names a SLUG, and a collection's identity is `(root, slug)`. Without the root,
// the browser re-resolves the slug through whatever binding is current when the card RENDERS —
// which, in a host that serves several projects, may be a different project than the one the card
// was made in. A card built in project A then shows project B's records: same slug, same title,
// different rows, nothing saying so.
//
// core carries a `scope` for exactly this, and `executePresentCollection` DELIBERATELY DROPS any
// scope it is handed in tool arguments — those are a model-controlled channel, and a model that
// could name the scope could name a project the user never opened. So the host stamps its own,
// and this is where: the tool-result sink is the last place that knows both the payload and the
// SESSION, and a session's directory is the server's own record of where it launched that agent.
//
// Stamped BEFORE storing, not on the way out, so a replayed card (the panel reloading a session's
// results from disk) carries the same scope as the live one. A card that changed project on
// reload would be the same bug arriving later.
import { withCardScope, TOOL_DEFINITION as PRESENT_COLLECTION, type PresentCollectionData } from "@mulmoclaude/core/collection";
import { isRecord } from "../../common/isRecord.js";
import { projectIdForRoot, projectScopeForCwd } from "../infra/project-root.js";

/** The card payload lives under `data` on a tool result; `jsonData` is the narration copy some
 *  plugins send instead. Only the rendered one is stamped — the other is text for the agent.
 *
 *  Narrowed on `collectionSlug` rather than asserted: the payload arrives as JSON from a broker
 *  that forwards a plugin's output unchanged, so "it is a card" is something to CHECK. A result
 *  that is not one passes through, which is also what a future payload shape would do — no scope
 *  rather than a wrong one. */
function cardPayload(stored: Record<string, unknown>): PresentCollectionData | null {
  const data = stored.data;
  if (!isRecord(data) || typeof data.collectionSlug !== "string" || data.collectionSlug.length === 0) return null;
  return { ...data, collectionSlug: data.collectionSlug };
}

/** Add this session's project to a `presentCollection` result, in place of nothing.
 *
 *  Everything else passes through untouched — another tool, a result with no payload, or a
 *  session whose directory is not a project the server serves (the workspace, or a directory the
 *  user never saved). `withCardScope` with `undefined` returns the payload without a `scope`
 *  property at all, which is exactly what a single-workspace host produces.
 *
 *  An OPAQUE id, never a path: this payload reaches the browser and, through a custom view, an
 *  LLM-authored iframe. */
export function stampCardScope<T extends Record<string, unknown>>(toolName: string, stored: T, where: CardOrigin): T {
  if (toolName !== PRESENT_COLLECTION.name) return stored;
  const data = cardPayload(stored);
  if (!data) return stored;
  // A PRIOR CARD DECIDES, including when it decided "no scope". Reading its absent scope as "no
  // prior card" is the same bug mirrored: a workspace card is deliberately unscoped, and deriving
  // again would give it a project the moment the session moved into one.
  const scope = where.prior ? where.prior.scope : (projectIdForRoot(projectScopeForCwd(where.cwdOf(where.sessionId)).workspaceRoot) ?? undefined);
  if (scope === undefined) return stored;
  return { ...stored, data: withCardScope(data, scope) };
}

export interface CardOrigin {
  sessionId: string;
  /** Where that session is running — the server's own record (`cwdForSession`). */
  cwdOf: (sessionId: string) => string;
  /** The card this result REPLACES, when there is one — and its scope wins, INCLUDING when it has
   *  none.
   *
   *  A card's project is decided when it is MADE, and a same-uuid update replaces the stored entry
   *  wholesale, so re-deriving from the session would let a card change project afterwards. Not
   *  hypothetical: the panel POSTs back through this route to persist a view's state, and a cell
   *  can be relaunched in another directory between the two.
   *
   *  PRESENCE is what this carries, which is why it is the card and not its scope. A workspace
   *  card is deliberately unscoped; reading that absence as "no prior card" would derive one and
   *  scope it to whatever project the session had moved into — the same bug, mirrored. */
  prior?: { scope: string | undefined } | undefined;
}

/** A stored result read back as "the card this update replaces", or undefined when it is not a
 *  card at all (nothing stored, or another tool's result).
 *
 *  The two answers must not collapse: `{ scope: undefined }` is a workspace card and `undefined`
 *  is no card, and only the second may be re-derived. Narrowed rather than trusted — this comes
 *  back from disk, written by an older build for all this one knows. */
export function priorCardOf(stored: unknown): { scope: string | undefined } | undefined {
  if (!isRecord(stored) || !isRecord(stored.data) || typeof stored.data.collectionSlug !== "string") return undefined;
  const scope = stored.data.scope;
  return { scope: typeof scope === "string" && scope.length > 0 ? scope : undefined };
}
