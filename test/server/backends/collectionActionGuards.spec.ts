// @vitest-environment node
import { describe, it, expect } from "vitest";
import { actionVisible } from "@mulmoclaude/core/collection";
import { refuseReadOnlyCollection, resolveItemAction, visibilityGate } from "../../../server/backends/collectionActionGuards.js";

// `resolveActionableRecord` is not here: it reads through `storeFor`, so its 404 /
// 409 are covered against real on-disk collections by both routes that call it, in
// collections.spec.ts ("action routes (seed prompts)" and "custom-view mutate actions").

// visibilityGate rebuilds an action's state gate so core's exact-optional parameter accepts it
// (the schema parse leaves the key holding `undefined`). It is the AUTHORIZATION check — the
// client hides out-of-state buttons, but a crafted request can still target one — so the two
// spellings of the same gate must both survive the rebuild. `when` belongs to the seeded kinds,
// `require` to mutate; forwarding only one silently makes that kind's actions always runnable.
describe("visibilityGate", () => {
  const WHEN = { field: "status", in: ["ready"] };

  it("forwards a seeded action's `when`", () => {
    expect(visibilityGate({ id: "a", label: "A", kind: "chat", role: "r", template: "t", when: WHEN })).toEqual({ when: WHEN });
  });

  it("forwards a mutate action's `require`", () => {
    expect(visibilityGate({ id: "a", label: "A", kind: "mutate", set: { status: "done" }, require: WHEN })).toEqual({ require: WHEN });
  });

  it("drops the key entirely for an ungated action, rather than leaving it undefined", () => {
    const gate = visibilityGate({ id: "a", label: "A", kind: "mutate", set: { status: "done" } });
    expect(Object.hasOwn(gate, "when")).toBe(false);
    expect(Object.hasOwn(gate, "require")).toBe(false);
  });

  // The gate is what actionVisible reads, so the round trip is what actually has to hold.
  it("keeps a mutate action hidden on a record that fails its `require`", () => {
    const gate = visibilityGate({ id: "a", label: "A", kind: "mutate", set: { status: "done" }, require: WHEN });
    expect(actionVisible(gate, { status: "draft" })).toBe(false);
    expect(actionVisible(gate, { status: "ready" })).toBe(true);
  });
});

// The two guards that answer the response themselves. What a CALLER sees is the
// null / the boolean, and that is what decides whether it goes on — a route test
// can only observe the status, so assert the return value here.
describe("route-answering action guards", () => {
  const fakeRes = () => {
    const sent: { status: number; body: unknown } = { status: 0, body: null };
    const res = {
      status(code: number) {
        sent.status = code;
        return res;
      },
      json(body: unknown) {
        sent.body = body;
        return res;
      },
    };
    return { res, sent };
  };
  const collectionWith = (extra: object) => ({ slug: "col", schema: {}, ...extra }) as unknown as Parameters<typeof resolveItemAction>[1];
  const CLOSE = { id: "close", label: "Close", kind: "mutate", set: { status: "closed" } };

  it("404s an action the collection does not declare, naming both ids", () => {
    const { res, sent } = fakeRes();
    expect(resolveItemAction(res as never, collectionWith({ schema: { actions: [CLOSE] } }), "nope")).toBeNull();
    expect(sent.status).toBe(404);
    expect((sent.body as { error: string }).error).toContain("'nope'");
    expect((sent.body as { error: string }).error).toContain("'col'");
  });

  it("404s on a collection that declares no actions at all", () => {
    const { res, sent } = fakeRes();
    expect(resolveItemAction(res as never, collectionWith({}), "close")).toBeNull();
    expect(sent.status).toBe(404);
  });

  it("returns the declared action without touching the response", () => {
    const { res, sent } = fakeRes();
    expect(resolveItemAction(res as never, collectionWith({ schema: { actions: [CLOSE] } }), "close")).toEqual(CLOSE);
    expect(sent.status).toBe(0);
  });

  // The boolean IS the control flow — a guard that answered 405 but reported false
  // would let its caller go on and write to a read-only collection.
  it("reports whether it sent the read-only 405", () => {
    const writable = fakeRes();
    expect(refuseReadOnlyCollection(writable.res as never, collectionWith({ dataDir: "/data/col/items" }))).toBe(false);
    expect(writable.sent.status).toBe(0);

    const readOnly = fakeRes();
    expect(refuseReadOnlyCollection(readOnly.res as never, collectionWith({ schema: { dataSource: { kind: "csv", path: "x.csv" } } }))).toBe(true);
    expect(readOnly.sent.status).toBe(405);
    expect((readOnly.sent.body as { error: string }).error).toContain("read-only");
  });
});
