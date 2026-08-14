// Which project the collection surface is looking at.
//
// A Project IS a directory (plans/project-architecture.md D2), and in this app a directory is
// already something the user has on screen: a cell. So the collections pane does not ask which
// project to show — it shows the one belonging to the cell it is attached to, and this module is
// how a cwd becomes the opaque id the API takes.
//
// The id, not the path, is what goes back to the server: it resolves ids against its own list of
// known directories and never accepts a root from the client (server/infra/project-root.ts). The
// listing returns the cwd so the client can MATCH a project to the cell it is already showing —
// the browser has those paths regardless.
//
// WHICH project is active belongs to the SURFACE being looked at, not to this module — see
// collectionSurface.ts. A global "active project" made a mounted pane own the scope for every
// consumer, including the full-screen overlay opened over it.
import { activeCollectionProjectId } from "./collectionSurface";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";

export interface CollectionProject {
  id: string;
  label: string;
  cwd: string;
}

let cache: Promise<CollectionProject[]> | null = null;
// The resolved list, kept beside the promise so a caller that cannot await still gets an answer
// once one exists (`cachedProjectIdForCwd`).
let settled: CollectionProject[] | null = null;

function asProjects(body: unknown): CollectionProject[] {
  if (!isRecord(body) || !isUnknownArray(body.projects)) return [];
  return body.projects.filter(
    (row): row is CollectionProject => isRecord(row) && typeof row.id === "string" && typeof row.label === "string" && typeof row.cwd === "string",
  );
}

/** Every directory a collection request may name. Cached: the list changes only when the user
 *  launches from a new directory, and the pane asks for it on every open. */
export async function listCollectionProjects(): Promise<CollectionProject[]> {
  // A FAILURE IS NOT CACHED. Caching the caught `[]` would make one timeout permanent: every
  // directory would read as unknown until a full reload, which looks exactly like "this folder
  // has no collections" — the state the pane deliberately shows for a real miss.
  cache ??= (async () => {
    const res = await fetchWithTimeout("/api/collection-projects");
    if (!res.ok) throw new Error(`collection-projects: HTTP ${res.status}`);
    settled = asProjects(await res.json());
    return settled;
  })().catch((err: unknown) => {
    cache = null;
    throw err;
  });
  return cache;
}

/** Drop the cached list — after launching from a directory that was not in it. */
export function forgetCollectionProjects(): void {
  cache = null;
  settled = null;
}

/** The project id for a cwd from the ALREADY-FETCHED list, or `undefined` when the list has not
 *  arrived yet — which is a different answer from `null` ("known, and not a project").
 *
 *  Exists so a surface can scope itself SYNCHRONOUSLY once the list is warm. The async lookup is
 *  a race against the cards it is supposed to scope: they mount and self-fetch immediately, so a
 *  scope that arrives a tick later arrives after the request it was for. */
export function cachedProjectIdForCwd(cwd: string | null | undefined): string | null | undefined {
  if (!cwd) return null;
  if (!settled) return undefined;
  return settled.find((project) => project.cwd === cwd)?.id ?? null;
}

/** The project id for a cell's cwd, or null when that directory is not one the server knows.
 *  A null is not an error: a cell may sit in a directory the user has never saved, and the pane
 *  says so rather than quietly showing the workspace's collections under its name. */
export async function projectIdForCwd(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  const found = async (): Promise<string | null> => {
    try {
      return (await listCollectionProjects()).find((project) => project.cwd === cwd)?.id ?? null;
    } catch {
      return null;
    }
  };
  const hit = await found();
  if (hit) return hit;
  // A MISS RE-ASKS, once. The server records a directory when a terminal launches from it, so a
  // list fetched earlier in the session can be genuinely out of date — and the failure mode of
  // trusting it is a folder that stays "unknown" forever with nothing to retry it.
  forgetCollectionProjects();
  return found();
}

/** Append the active project to a collection API url.
 *
 *  Applied at the three api helpers in collectionUi.ts, which every collection call goes
 *  through — the client's counterpart to the server resolving every root in one place.
 *
 *  NOT applied to the view-data endpoints: those are reached by the sandboxed iframe using the
 *  url minted with its token, and that token is what names their project. A parameter here would
 *  land inside the suffixes the view contract builds by concatenation (`dataUrl + "/query"`). */
export function withActiveProject(url: string): string {
  return withProject(url, activeCollectionProjectId());
}

/** Append a NAMED project to a collection API url — the same rule, for a caller that already
 *  knows which project it means rather than asking what is on screen.
 *
 *  That is the difference a chat card needs: a card was made in one project and must keep reading
 *  it, while `activeCollectionProjectId()` moves with the pane the user is looking at. The card's
 *  scope comes from its own payload (`PresentCollectionData.scope`, stamped by the host, never by
 *  the model). */
export function withProject(url: string, id: string | null): string {
  if (!id || url.includes("/view-data")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}project=${encodeURIComponent(id)}`;
}
