// Which root a request operates against — the one choke point four subsystems will
// share (collections now; accounting, wiki and resources later, see
// plans/project-architecture.md D4).
//
// A request names its project with an OPAQUE ID, never a path. That is not tidiness: the
// engine's `resolveDataDir` guarantees containment only WITHIN the root it is handed, so the
// root itself is the trust boundary. A client-supplied path would turn every collection route
// into an arbitrary-directory reader. Ids resolve against directories the app already knows —
// the shared workspace and the saved `cwdPresets` — and anything else is refused.
//
// The id is DERIVED from the path rather than stored, so it survives restarts and needs no
// registry: the list of projects is already `cwdPresets`, which follows from a Project simply
// BEING a directory (plans/project-architecture.md D2). It also keeps the path out of what
// travels back IN — URLs, view tokens, logs — which is where a path is a liability.
//
// The other half of the contract lives in the engine binding: the collection host runs in
// explicit-root mode (`workspaceRoot: null`), so nothing can fall back to an ambient root when
// a call site forgets to pass one — it throws instead. Serving several roots is only safe
// because that fallback is gone.
import { createHash } from "node:crypto";
import path from "node:path";
import type { Request } from "express";
import { describeValue } from "../../common/readString.js";
import { lastSegment } from "../../common/pathSegments.js";

/** A root, in the shape the collection engine's options already take, so it can be passed
 *  straight through as `opts` rather than unpacked at every call site. */
export interface ProjectScope {
  workspaceRoot: string;
}

/** A project as the client sees it.
 *
 *  `cwd` is included because the client has to MATCH a project to a cell it is already showing,
 *  and a cell is identified by its cwd. That is not a hole in the id: the invariant is that the
 *  SERVER resolves an id against its own list and never takes a root from the client — a path on
 *  the way out does not weaken it, and the browser already has every cell's cwd. What the id
 *  buys is that the path is not what travels back in, in URLs, tokens or logs. */
export interface ProjectSummary {
  id: string;
  label: string;
  cwd: string;
}

/** A request that named a project this server cannot serve. Carries the status the route
 *  should answer with, so an unknown id reads as the client error it is rather than as a 500
 *  that looks like the server broke. */
export class ProjectRootError extends Error {
  readonly status = 400;
}

/** The status a caught error should answer with — `ProjectRootError`'s own, 500 otherwise. */
export function errorStatus(err: unknown): number {
  return err instanceof ProjectRootError ? err.status : 500;
}

interface KnownProject {
  label: string;
  path: string;
}

let workspace: string | null = null;
let knownProjects: () => KnownProject[] = () => [];

/** Bind the shared workspace and the source of saved directories. Call once at boot, before
 *  any route resolves a scope.
 *
 *  `knownProjects` is a THUNK because the saved directories change while the server runs —
 *  launching from a new directory records one — and a list captured at boot would refuse a
 *  project the user can see in their own launcher. */
export function initProjectRoots(deps: { workspace: string; knownProjects?: () => KnownProject[] }): void {
  workspace = deps.workspace;
  knownProjects = deps.knownProjects ?? (() => []);
}

/** Whether the binding is in place. Routes that answered 503 for "backend not initialized"
 *  before this module existed keep answering 503, rather than throwing into a 500. */
export function projectRootsConfigured(): boolean {
  return workspace !== null;
}

/** Test-only: drop the binding so a spec can assert the unconfigured failure. */
export function resetProjectRootsForTesting(): void {
  workspace = null;
  knownProjects = () => [];
}

function requireWorkspace(): string {
  if (workspace === null) {
    throw new Error("project roots are not configured — call initProjectRoots({ workspace }) at boot");
  }
  return workspace;
}

/** The opaque id for a root. A truncated digest: stable across restarts (nothing is stored),
 *  short enough to sit in a URL, and not reversible into the path it names.
 *
 *  16 hex characters is 64 bits. A collision would need billions of directories, and even then
 *  it could only confuse two of the user's OWN projects — never reach one outside the list,
 *  since an id that matches nothing resolves to nothing. */
export function projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

/** A directory's NAME, never its location.
 *
 *  `lastSegment` answers with the path itself when there is nothing to take — `"/"` for a POSIX
 *  root, `"C:"` for a Windows drive root — and that value travels: the phone's project listing
 *  promises a label that is never a path. Derived here, once, rather than checked wherever a
 *  label is used.
 *
 *  `path.basename` is not used for the same reason `lastSegment` exists: this process's `path` is
 *  its own platform's, and a config written on Windows can be read on a mac. */
function nameOf(root: string): string {
  const name = lastSegment(root).trim();
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && !/^[a-z]:$/i.test(name) ? name : "root";
}

/** Every project a request may name, workspace first. Deduped by root: a user who has launched
 *  from the workspace has it among the saved directories too. */
export function listProjectRoots(): ProjectSummary[] {
  const ws = requireWorkspace();
  // `lastSegment`, not `path.basename`: this process's `path` is its own platform's, and a config
  // written on Windows can be read on a mac (a synced config, a restored backup). A POSIX
  // basename hands `C:\Users\me\proj` back WHOLE — which then travels as a "label" to a phone
  // that is promised it will never receive a path.
  const rows: Array<{ root: string; label: string }> = [{ root: ws, label: nameOf(ws) }];
  for (const project of knownProjects()) {
    if (!rows.some((row) => row.root === project.path)) rows.push({ root: project.path, label: project.label });
  }
  return rows.map((row) => ({ id: projectId(row.root), label: row.label, cwd: row.root }));
}

/** The opaque id for a ROOT the server serves, or null when it serves none — which is also
 *  the answer for the WORKSPACE, deliberately: the workspace is what a request naming no
 *  project gets, so a link into it carries no id and stays byte-identical to the one this app
 *  built before projects existed (and to MulmoClaude's, which has only that root).
 *
 *  The inverse of `rootForProjectId`, and matched against the SAME list it resolves against —
 *  by RESOLVED path, not by string equality. Hashing the caller's root directly would mint an
 *  id that resolves to nothing: `cwdPresets` holds the path as the user saved it while the
 *  collection engine hands back a `path.resolve`d form, so a trailing slash or a `.` segment
 *  would be a different digest of the same directory.
 *
 *  Exported for the completion-bell adapter, whose deep link has to name a project the client
 *  can then ask for. */
export function projectIdForRoot(root: string): string | null {
  if (workspace === null) return null;
  const target = path.resolve(root);
  if (path.resolve(workspace) === target) return null;
  for (const project of knownProjects()) {
    if (path.resolve(project.path) === target) return projectId(project.path);
  }
  return null;
}

/** The root an opaque id names, or null when it names none. Exported because the view-token
 *  middleware resolves the id carried IN a token, which never passes through a query string. */
export function rootForProjectId(id: string): string | null {
  if (projectId(requireWorkspace()) === id) return requireWorkspace();
  for (const project of knownProjects()) {
    if (projectId(project.path) === id) return project.path;
  }
  return null;
}

/** The root this request operates against: the project it named, or the workspace when it
 *  named none.
 *
 *  PRESENCE is the test, not the value's shape. `?project=a&project=b` arrives as an array and
 *  `?project[x]=y` as an object, so a `typeof === "string"` guard would read both as "absent"
 *  and serve the workspace — one project asked for, another served, with nothing anywhere
 *  saying so. That is the silent-wrong-root failure explicit-root mode removed from the engine,
 *  and it must not come back through the wire. */
export function resolveProjectRoot(req: Request): ProjectScope {
  const attached = attachedScopes.get(req);
  if (attached) return attached;
  if (!Object.hasOwn(req.query, "project")) return { workspaceRoot: requireWorkspace() };
  const requested = req.query.project;
  if (typeof requested === "string") {
    const root = rootForProjectId(requested);
    if (root !== null) return { workspaceRoot: root };
  }
  // Caller-controlled, and it lands in a log line; `describeValue` renders a non-string shape
  // without interpolating it, and CR/LF is stripped so no id can forge one.
  throw new ProjectRootError(`unknown project: ${describeValue(requested).replace(/[\r\n]/g, " ")}`);
}

// Scopes resolved by AUTHORIZATION rather than by the query string. A custom view's iframe
// fetches URLs the bundled API contract builds by concatenation (`dataUrl + "/query"`), so a
// project cannot ride in the query there without corrupting those suffixes — the token carries
// it instead, and the middleware that verifies the token records the root it authorized. A
// WeakMap because the key is the request object and the entry should die with it.
const attachedScopes = new WeakMap<Request, ProjectScope>();

/** Record the root a request was AUTHORIZED for, so every handler behind that middleware
 *  resolves the same one through the usual accessor. */
export function attachProjectScope(req: Request, scope: ProjectScope): void {
  attachedScopes.set(req, scope);
}

/** The request's root as a cache-key fragment, or "" when it names a project this server
 *  cannot resolve. Deliberately does NOT throw: a caller building a key is not the place an
 *  unknown project should be reported — the route it guards answers that. */
export function projectRootKey(req: Request): string {
  try {
    return resolveProjectRoot(req).workspaceRoot;
  } catch {
    return "";
  }
}

/** The root for a SESSION's working directory — the agent's side of the same question the
 *  query parameter answers for the browser.
 *
 *  No membership check, and the difference from `resolveProjectRoot` is the point: a query
 *  parameter is client input, so it is matched against a list the server owns. A session's cwd is
 *  the server's OWN record of where it launched that agent (`cwdForSession`), and refusing a
 *  directory it started an agent in would mean the agent cannot manage the collections of the
 *  folder it is standing in — which is the whole feature.
 *
 *  Falls back to the workspace when the caller has no session: the scheduler, a direct POST, a
 *  boot path. Their behaviour is exactly what it was. */
export function projectScopeForCwd(cwd: string | null | undefined): ProjectScope {
  return { workspaceRoot: cwd && cwd.length > 0 ? cwd : requireWorkspace() };
}

/** The shared workspace, for callers that have no request: boot paths, the agent tool
 *  dispatch, the completion watchers. Separate from `resolveProjectRoot` so those callers read
 *  as what they are — "the workspace" — rather than as a request that lost its `req`. */
export function workspaceScope(): ProjectScope {
  return { workspaceRoot: requireWorkspace() };
}
