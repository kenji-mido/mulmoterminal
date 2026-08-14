// @vitest-environment node
//
// The agent's half of the portability check. What matters here is how QUIET it is: the note rides
// along with a write the agent already made, and everything else — a refusal, a read, a clean
// collection, a check that could not run — comes back exactly as it did before this existed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const check = vi.fn();
vi.mock("../../../server/backends/collectionSelfContainment.js", () => ({
  checkCollectionSelfContainment: (slug: string, scope: { workspaceRoot: string }) => check(slug, scope),
}));

import { withPortabilityNote } from "../../../server/infra/collectionToolPortability.js";

const WRITTEN = JSON.stringify({ collection: "notes", written: true });
const BLOCKED = {
  slug: "notes",
  portable: false,
  findings: [{ code: "sqlite-store", severity: "blocker", message: "Records are one SQLite file; git cannot merge it." }],
};

/** The wrapped handler, plus the inner handler's call log. */
function wrap(narration: string | (() => Promise<string>), root = "/srv/proj") {
  const inner = vi.fn(async () => (typeof narration === "string" ? narration : narration()));
  return { run: withPortabilityNote(inner, () => root), inner };
}

beforeEach(() => {
  check.mockReset().mockResolvedValue(BLOCKED);
});

describe("withPortabilityNote", () => {
  it("adds the findings to a successful putSchema, keeping what the tool already said", async () => {
    const { run } = wrap(WRITTEN);
    const out = JSON.parse(await run({ action: "putSchema", slug: "notes" }));
    expect(out).toMatchObject({ collection: "notes", written: true });
    expect(out.portability).toEqual({ portable: false, findings: BLOCKED.findings });
    expect(check).toHaveBeenCalledWith("notes", { workspaceRoot: "/srv/proj" });
  });

  it("says NOTHING about a collection that already travels", async () => {
    check.mockResolvedValue({ slug: "notes", portable: true, findings: [] });
    const { run } = wrap(WRITTEN);
    expect(await run({ action: "putSchema", slug: "notes" })).toBe(WRITTEN);
  });

  // A refusal is PROSE, and prose is what the agent is meant to read and act on — appending to it
  // would bury the reason the write did not happen.
  it("passes a refusal through untouched, and does not ask about it", async () => {
    const refusal = "manageCollection: unknown collection 'notes' — create it by writing SKILL.md…";
    const { run } = wrap(refusal);
    expect(await run({ action: "putSchema", slug: "notes" })).toBe(refusal);
    expect(check).not.toHaveBeenCalled();
  });

  it("leaves a JSON result that is not a write alone", async () => {
    const body = JSON.stringify({ collection: "notes", written: false });
    const { run } = wrap(body);
    expect(await run({ action: "putSchema", slug: "notes" })).toBe(body);
    expect(check).not.toHaveBeenCalled();
  });

  // Every other action either cannot change the answer (the record actions) or would spend a git
  // call per listing to repeat it.
  it("does not touch the other actions, or spend a check on them", async () => {
    for (const action of ["getSchema", "getItems", "putItems", "deleteItems", "queryItems", "schemaDocs", "getOntology"]) {
      const { run } = wrap(WRITTEN);
      expect(await run({ action, slug: "notes" })).toBe(WRITTEN);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it("still reports the write when the check itself fails", async () => {
    check.mockRejectedValue(new Error("git is not on PATH"));
    const { run } = wrap(WRITTEN);
    expect(await run({ action: "putSchema", slug: "notes" })).toBe(WRITTEN);
  });

  it("still reports the write when the collection cannot be loaded back", async () => {
    check.mockResolvedValue(null);
    const { run } = wrap(WRITTEN);
    expect(await run({ action: "putSchema", slug: "notes" })).toBe(WRITTEN);
  });

  it("needs a slug to ask about", async () => {
    const { run } = wrap(WRITTEN);
    expect(await run({ action: "putSchema" })).toBe(WRITTEN);
    expect(await run({ action: "putSchema", slug: "" })).toBe(WRITTEN);
    expect(check).not.toHaveBeenCalled();
  });

  it("reads the root at CALL time, not when the handler was built", async () => {
    // The workspace handler is built at module scope, before boot binds a root — a value read
    // then would be the wrong one, or none.
    let root = "/srv/first";
    const run = withPortabilityNote(
      async () => WRITTEN,
      () => root,
    );
    await run({ action: "putSchema", slug: "notes" });
    root = "/srv/second";
    await run({ action: "putSchema", slug: "notes" });
    expect(check.mock.calls.map((call) => call[1])).toEqual([{ workspaceRoot: "/srv/first" }, { workspaceRoot: "/srv/second" }]);
  });
});
