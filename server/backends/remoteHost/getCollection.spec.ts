// @vitest-environment node
//
// Unit tests for the remote-host getCollection handler, engine stubbed via
// GetCollectionDeps so these assert wiring, derivation and pagination rather than
// the real collection engine. The end-to-end read against a real on-disk dataDir
// lives in getFeed.spec.ts (same page path).
//
// The store-seam test is the one this file exists for (#1488): records must come
// from `listRecords` (storeFor(...).list() in production), never from a dataDir
// read, or a CSV/SQLite-backed collection pages as empty on the phone.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createGetCollection, type GetCollectionDeps } from "./handlers/getCollection.js";
import { initProjectRoots, resetProjectRootsForTesting } from "../../infra/project-root.js";

// The handler RESOLVES its scope per call now (commandScope.ts) instead of capturing the
// workspace in its deps, so the roots binding has to exist — the same binding boot installs. A
// handler that reaches it unconfigured should fail loudly rather than invent a root, which is why
// this is set up here rather than defaulted away inside the resolver.
beforeEach(() => {
  initProjectRoots({ workspace: "/srv/ws" });
});

afterEach(() => {
  resetProjectRootsForTesting();
});

const records = (count: number) => Array.from({ length: count }, (_unused, index) => ({ id: `r${index}` }));

/** A collection whose dataDir holds nothing — as a `dataSource` CSV or SQLite
 *  collection's does. Everything the handler returns therefore had to come
 *  through `listRecords`. */
const collectionDeps = (all: Record<string, unknown>[]): GetCollectionDeps => ({
  loadCollection: (async (slug: string) =>
    slug === "missing"
      ? null
      : {
          slug,
          dataDir: `/nonexistent/${slug}`,
          schema: { primaryKey: "id", fields: { id: { type: "string" }, won: { type: "number" }, points: { type: "derived", formula: "won * 3" } } },
        }) as unknown as GetCollectionDeps["loadCollection"],
  listRecords: (async () => all) as unknown as GetCollectionDeps["listRecords"],
  toDetail: ((collection: { slug: string; schema: unknown }) => ({
    slug: collection.slug,
    title: collection.slug,
    icon: "x",
    source: "preset",
    schema: collection.schema,
  })) as unknown as GetCollectionDeps["toDetail"],
});

describe("createGetCollection", () => {
  it("reads records through the store seam, handing it the loaded collection", async () => {
    const seen: unknown[] = [];
    const deps = collectionDeps(records(2));
    const handler = createGetCollection({
      ...deps,
      listRecords: (async (collection: { slug: string }) => {
        seen.push(collection);
        return records(2);
      }) as unknown as GetCollectionDeps["listRecords"],
    });
    const result = (await handler({ slug: "csv-backed" })) as unknown as { items: unknown[]; total: number };
    // The dataDir is empty, so a dataDir-backed read would have returned nothing.
    expect(result.total).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ slug: "csv-backed" });
  });

  it("returns a page of records + detail + total", async () => {
    const handler = createGetCollection(collectionDeps(records(5)));
    const result = (await handler({ slug: "clients", offset: 1, limit: 2 })) as unknown as {
      collection: { slug: string };
      items: { id: string }[];
      total: number;
      offset: number;
      limit: number;
    };
    expect(result.total).toBe(5);
    expect(result.items.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(result.offset).toBe(1);
    expect(result.limit).toBe(2);
    expect(result.collection.slug).toBe("clients");
  });

  it("resolves record-local derived formulas before paging", async () => {
    const handler = createGetCollection(collectionDeps([{ id: "r0", won: 2 }]));
    const result = (await handler({ slug: "clients" })) as unknown as { items: { points?: number }[] };
    expect(result.items[0]?.points).toBe(6);
  });

  it("throws when the collection is not found", async () => {
    const handler = createGetCollection(collectionDeps(records(3)));
    await expect(handler({ slug: "missing" })).rejects.toThrow(/collection 'missing' not found/);
  });

  it("clamps a runaway limit and a negative offset, defaults a bad limit", async () => {
    const handler = createGetCollection(collectionDeps(records(500)));
    const huge = (await handler({ slug: "x", limit: 100000 })) as unknown as { limit: number };
    expect(huge.limit).toBe(200); // MAX_LIMIT
    const neg = (await handler({ slug: "x", offset: -5, limit: 0 })) as unknown as { offset: number; limit: number };
    expect(neg.offset).toBe(0);
    expect(neg.limit).toBe(50); // DEFAULT_LIMIT
  });
});
