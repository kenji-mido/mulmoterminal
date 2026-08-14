// @vitest-environment node
//
// The other half of per-card scoping: the plugin only asks the host for a scoped binding when the
// card CARRIES a scope, and core deliberately refuses to take one from tool arguments (a
// model-controlled channel). So if the host never stamps one, every card is unscoped and the
// scoped binding is dead code — which is exactly what review caught.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { stampCardScope, priorCardOf } from "../../../server/routes/stampCardScope.js";
import { initProjectRoots, projectId, resetProjectRootsForTesting } from "../../../server/infra/project-root.js";

const WORKSPACE = "/srv/ws";
const PROJECT = "/srv/mag2";
/** Where each fixture session is running — the server's own record, which is what the stamp
 *  reads. Anything unnamed is the workspace, as a session with no recorded cwd is. */
const CWDS: Record<string, string> = { "in-project": PROJECT, elsewhere: "/srv/never-saved" };
const cwdOf = (sessionId: string) => CWDS[sessionId] ?? WORKSPACE;
const card = (slug = "tasks") => ({ uuid: "u1", data: { collectionSlug: slug } });

beforeEach(() => {
  initProjectRoots({ workspace: WORKSPACE, knownProjects: () => [{ label: "mag2", path: PROJECT }] });
});

afterEach(() => {
  resetProjectRootsForTesting();
});

describe("stampCardScope", () => {
  it("stamps the session's project onto a collection card", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "in-project" });
    expect(out.data).toMatchObject({ collectionSlug: "tasks", scope: projectId(PROJECT) });
  });

  // An opaque id, never a path: this payload reaches the browser and, through a custom view, an
  // LLM-authored iframe.
  it("stamps an id, not a path", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "in-project" });
    expect(JSON.stringify(out)).not.toContain("/srv");
  });

  // The workspace is what a card with no scope already resolves to, so stamping it would add a
  // field that changes nothing — and every single-workspace card would suddenly carry one.
  it("leaves a workspace card unscoped", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "workspace-session" });
    expect(Object.hasOwn(out.data, "scope")).toBe(false);
  });

  it("leaves a card from a directory the server does not serve unscoped", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "elsewhere" });
    expect(Object.hasOwn(out.data, "scope")).toBe(false);
  });

  it("touches no other tool's result", () => {
    const result = { uuid: "u1", data: { collectionSlug: "tasks" } };
    expect(stampCardScope("presentChart", result, { cwdOf, sessionId: "in-project" })).toBe(result);
  });

  // The payload arrives as JSON from a broker that forwards a plugin's output unchanged, so "it
  // is a card" is checked rather than assumed. A shape this build does not recognise passes
  // through with no scope, which is better than a wrong one.
  it("passes through a result whose payload is not a card", () => {
    for (const stored of [{ uuid: "u1" }, { uuid: "u1", data: null }, { uuid: "u1", data: {} }, { uuid: "u1", data: { collectionSlug: "" } }]) {
      expect(stampCardScope("presentCollection", stored, { cwdOf, sessionId: "in-project" })).toBe(stored);
    }
  });

  // A card's project is decided when it is MADE. This same route persists a view's state change
  // under the card's uuid, replacing the stored entry wholesale — and a cell can be relaunched in
  // another directory in between, so re-deriving the scope here would let the card change project
  // after the fact. That is the bug the stamp exists to prevent, arriving by the back door.
  it("carries an existing card's scope forward, even when the session has moved", () => {
    const movedSession = "workspace-session"; // the cell now runs in the workspace
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: movedSession, prior: { scope: projectId(PROJECT) } });
    expect(out.data).toMatchObject({ scope: projectId(PROJECT) });
  });

  // THE MIRROR, and the one an `undefined` scope hides: a workspace card is deliberately
  // unscoped. Reading that absence as "no prior card" re-derives, and the card silently becomes
  // a project's the moment its session was relaunched in one.
  it("keeps a WORKSPACE card unscoped after its session moves into a project", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "in-project", prior: { scope: undefined } });
    expect(Object.hasOwn(out.data, "scope")).toBe(false);
  });

  it("derives the scope only when there is no prior card at all", () => {
    const out = stampCardScope("presentCollection", card(), { cwdOf, sessionId: "in-project" });
    expect(out.data).toMatchObject({ scope: projectId(PROJECT) });
  });

  // The two answers must not collapse: `{ scope: undefined }` is a workspace card, `undefined` is
  // no card, and only the second may be re-derived.
  it("tells a workspace card apart from no card at all", () => {
    expect(priorCardOf({ uuid: "u", data: { collectionSlug: "tasks", scope: "p1" } })).toEqual({ scope: "p1" });
    expect(priorCardOf({ uuid: "u", data: { collectionSlug: "tasks" } })).toEqual({ scope: undefined });
    expect(priorCardOf({ uuid: "u", data: { collectionSlug: "tasks", scope: "" } })).toEqual({ scope: undefined });
    for (const stored of [undefined, null, {}, { data: {} }, { data: { collectionSlug: 7 } }, "nope"]) {
      expect(priorCardOf(stored)).toBeUndefined();
    }
  });

  it("keeps everything else on the result", () => {
    const stored = { uuid: "u1", toolName: "presentCollection", viewState: { selected: "x" }, data: { collectionSlug: "tasks", title: "Tasks" } };
    const out = stampCardScope("presentCollection", stored, { cwdOf, sessionId: "in-project" });
    expect(out).toMatchObject({ uuid: "u1", viewState: { selected: "x" } });
    expect(out.data).toMatchObject({ collectionSlug: "tasks", title: "Tasks" });
  });
});
