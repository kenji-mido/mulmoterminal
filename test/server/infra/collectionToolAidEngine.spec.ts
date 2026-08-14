// @vitest-environment node
//
// The wrapper against the REAL engine, not a spy.
//
// The unit test beside this one feeds the wrapper a canned refusal, which proves the retry logic
// and proves nothing about the sentence it matches on: that string is the engine's, and the engine
// is free to reword it. This one runs the actual `manageCollection` handler against a repository
// whose `app.json` has no `aid`, which is the state a new shared app is in for the length of one
// tool call — and the state in which, before the wrapper, its first collection could not be
// written at all.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setSharedCollectionsSupport } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { manageCollectionHandlerFor } from "../../../server/infra/collection-tool.js";
import { makeTempDir } from "../../support/tempDir";

const schema = {
  title: "Responses",
  icon: "assignment",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: { id: { type: "string", label: "ID", primary: true, required: true }, name: { type: "string", label: "Name" } },
};

let root = "";

describe("a new shared app's first collection", () => {
  beforeAll(() => {
    initCollectionsBackend({ workspace: makeTempDir("mt-aid-engine-ws-") });
    // The host declares the capability; without it the engine refuses a firestore schema for a
    // different reason entirely ("this host does not support shared collections").
    setSharedCollectionsSupport(true);
  });

  beforeEach(() => {
    root = makeTempDir("mt-aid-engine-");
    // What the agent writes first: the declaration, with no aid — it does not invent one.
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ name: "Talk feedback", members: { "owner@example.com": { "*": "owner" } } }, null, 2));
    // `putSchema` refuses a collection that does not exist yet, so the directory comes first.
    mkdirSync(path.join(root, ".claude", "skills", "responses"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude", "skills", "responses", "SKILL.md"),
      "---\nname: responses\ndescription: Survey responses.\n---\n\nSurvey responses.\n",
    );
    writeFileSync(
      path.join(root, ".claude", "skills", "responses", "schema.json"),
      JSON.stringify({ ...schema, storage: undefined, dataPath: "data/responses/items" }),
    );
  });

  it("is written, and the aid is generated on the way", async () => {
    const message = await manageCollectionHandlerFor(root)({ action: "putSchema", slug: "responses", schema });
    // The engine's success narration is JSON with `written: true`; a refusal is prose.
    expect(message).toContain('"written"');
    const declaration = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8"));
    expect(declaration.aid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Nothing else about the author's file moved.
    expect(declaration.name).toBe("Talk feedback");
    expect(declaration.members).toEqual({ "owner@example.com": { "*": "owner" } });
  });

  it("keeps the aid it minted across a second write", async () => {
    await manageCollectionHandlerFor(root)({ action: "putSchema", slug: "responses", schema });
    const first = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).aid;
    await manageCollectionHandlerFor(root)({ action: "putSchema", slug: "responses", schema: { ...schema, title: "Responses v2" } });
    expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")).aid).toBe(first);
  });
});
