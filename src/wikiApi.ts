// Typed client for the read-only wiki REST surface (server/backends/wiki.ts). Thin
// fetch wrappers — the heavy lifting (slug resolution, graph, lint) all lives in the
// shared @mulmoclaude/core engine the server calls; the browser only renders the
// shapes it returns. Types mirror @mulmoclaude/core/wiki(/server) so the views stay
// in lockstep with the engine.
import type { WikiPageEntry, WikiGraph } from "@mulmoclaude/core/wiki";
import { isRecord } from "../common/isRecord";
import { fetchWithTimeout } from "./utils/fetchWithTimeout";

/** index.md raw content + its parsed page entries (GET /api/wiki). */
export interface WikiIndex {
  content: string;
  entries: WikiPageEntry[];
}

/** A single resolved page (GET /api/wiki?slug=). `exists: false` is returned for a
 *  404 so callers can render the not-found state without a throw. */
export interface WikiPage {
  filePath: string | null;
  content: string;
  exists: boolean;
  resolvedTitle: string;
}

/** Lint issues + the rendered markdown report (GET /api/wiki/lint). */
export interface WikiLint {
  issues: string[];
  report: string;
}

// Each endpoint hands `getJson` the reader for its own shape, so the response is CHECKED rather
// than named: the generic used to be satisfied by an assertion, which made `getJson<WikiIndex>`
// a claim about the server rather than a question asked of it.
async function getJson<T>(url: string, read: (raw: unknown) => T): Promise<T> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return read(await res.json());
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const rows = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// An identifier the UI keys and navigates by, or null. Deliberately NOT defaulted to "": a slug is
// not display text — several rows missing one would collide on the same key, and a link built from
// it goes nowhere. Rows without a usable id are dropped instead (Codex review on #1282).
const id = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

// DISPLAY fields do default to "": they only ever render as text, so a partial response should
// show what arrived rather than blank the page.
const readEntry = (raw: unknown): WikiPageEntry[] => {
  const o = isRecord(raw) ? raw : {};
  const slug = id(o.slug);
  if (!slug) return [];
  return [
    {
      title: str(o.title),
      slug,
      description: str(o.description),
      tags: rows(o.tags).filter((tag): tag is string => typeof tag === "string"),
    },
  ];
};

const readIndex = (raw: unknown): WikiIndex => {
  const o = isRecord(raw) ? raw : {};
  return { content: str(o.content), entries: rows(o.entries).flatMap(readEntry) };
};

const readGraph = (raw: unknown): WikiGraph => {
  const o = isRecord(raw) ? raw : {};
  const nodes = rows(o.nodes).flatMap((n) => {
    const slug = id(isRecord(n) ? n.slug : undefined);
    return slug ? [{ slug, title: str(isRecord(n) ? n.title : undefined) }] : [];
  });
  const edges = rows(o.edges).flatMap((e) => {
    const from = id(isRecord(e) ? e.from : undefined);
    const to = id(isRecord(e) ? e.to : undefined);
    return from && to ? [{ from, to }] : [];
  });
  return { nodes, edges };
};

const readLint = (raw: unknown): WikiLint => {
  const o = isRecord(raw) ? raw : {};
  return { issues: rows(o.issues).filter((issue): issue is string => typeof issue === "string"), report: str(o.report) };
};

const readPage = (raw: unknown, slug: string): WikiPage => {
  const o = isRecord(raw) ? raw : {};
  return {
    filePath: typeof o.filePath === "string" ? o.filePath : null,
    content: str(o.content),
    exists: o.exists === true,
    resolvedTitle: typeof o.resolvedTitle === "string" ? o.resolvedTitle : slug,
  };
};

export function fetchWikiIndex(): Promise<WikiIndex> {
  return getJson("/api/wiki", readIndex);
}

/** Fetch one page. A 404 resolves to an `exists: false` page rather than throwing,
 *  so the view can show "page not found"; other errors still throw. */
export async function fetchWikiPage(slug: string): Promise<WikiPage> {
  const res = await fetchWithTimeout(`/api/wiki?slug=${encodeURIComponent(slug)}`);
  if (res.status === 404) return { filePath: null, content: "", exists: false, resolvedTitle: slug };
  if (!res.ok) throw new Error(`/api/wiki?slug=${slug} → ${res.status}`);
  return readPage(await res.json(), slug);
}

export function fetchWikiGraph(): Promise<WikiGraph> {
  return getJson("/api/wiki/graph", readGraph);
}

export function fetchWikiLint(): Promise<WikiLint> {
  return getJson("/api/wiki/lint", readLint);
}
