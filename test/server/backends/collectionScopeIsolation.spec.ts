// @vitest-environment node
//
// `~` and a project are separate worlds. A collection under `~/.claude/skills` is a
// machine-global thing no clone of a repository can have, so standing in a project directory it
// must not be reachable AT ALL — and "at all" is the point of this file. Filtering the listing
// alone would be a label on a door that still opens: `loadCollection` is what getSchema,
// getItems, putItems, the detail route, the view-token mint and the watcher all go through, so a
// slug typed by the agent (or arriving in a URL) would still resolve into the other world and
// write to its data dir.
//
// Nothing leaked before core 3.3.0 by luck rather than design — `~/.claude/skills` happened to
// hold no `schema.json`. One user-scope collection would have appeared in every project.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discoverCollections, loadCollection } from "@mulmoclaude/core/collection/server";

import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { makeTempDir } from "../../support/tempDir";
import { takeScratchHome, type ScratchHome } from "../../support/scratchHome";

const schemaFor = (title: string, slug: string) => ({
  title,
  icon: "star",
  dataPath: `data/${slug}/items`,
  primaryKey: "id",
  fields: { id: { type: "string", label: "ID", primary: true, required: true } },
});

/** Write `<skillsRoot>/<slug>/schema.json`, the shape discovery accepts as a collection. */
function writeCollection(skillsRoot: string, slug: string, title: string): void {
  mkdirSync(path.join(skillsRoot, slug), { recursive: true });
  writeFileSync(path.join(skillsRoot, slug, "schema.json"), JSON.stringify(schemaFor(title, slug)));
}

const slugs = (collections: Array<{ slug: string }>): string[] => collections.map((collection) => collection.slug).sort();

describe("user scope reaches the managed workspace only", () => {
  const savedWorkspaceEnv = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  let home: ScratchHome | null = null;
  let workspace = "";
  let project = "";

  // ONE binding for the file — `configureCollectionHost` refuses a second call with a different
  // host on purpose. Home is redirected because the binding derives `~/.claude/skills` from
  // `os.homedir()`, called afresh on every discovery; the real one must never be scanned here.
  // Through `takeScratchHome`, which moves HOME *and* USERPROFILE and then verifies os.homedir()
  // followed — on Windows only the latter counts, and stubbing HOME alone would leave this test
  // reading the runner's own `~/.claude/skills`.
  beforeAll(() => {
    home = takeScratchHome("mt-scope-home-");
    writeCollection(path.join(home.path, ".claude", "skills"), "user-only", "User Only");

    workspace = makeTempDir("mt-scope-ws-");
    project = makeTempDir("mt-scope-proj-");
    for (const root of [workspace, project]) {
      writeCollection(path.join(root, ".claude", "skills"), "tasks", "Tasks");
      mkdirSync(path.join(root, "data", "tasks", "items"), { recursive: true });
      mkdirSync(path.join(root, "data", "user-only", "items"), { recursive: true });
    }
    // `isManagedWorkspace` compares against this, so a temp dir can stand in for ~/mulmoclaude.
    process.env.MULMOCLAUDE_WORKSPACE_PATH = workspace;
    initCollectionsBackend({ workspace, knownProjects: () => [{ label: "project", path: project }] });
  });

  afterAll(() => {
    if (savedWorkspaceEnv === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
    else process.env.MULMOCLAUDE_WORKSPACE_PATH = savedWorkspaceEnv;
    home?.release();
  });

  it("merges user scope into the managed workspace", async () => {
    expect(slugs(await discoverCollections({ workspaceRoot: workspace }))).toEqual(["tasks", "user-only"]);
    expect(await loadCollection("user-only", { workspaceRoot: workspace })).not.toBeNull();
  });

  it("hides user scope from a project, in the listing", async () => {
    expect(slugs(await discoverCollections({ workspaceRoot: project }))).toEqual(["tasks"]);
  });

  // The half that matters: a slug is a MISS, not a quiet hop into ~/.claude/skills.
  it("hides user scope from a project, in resolution by slug", async () => {
    expect(await loadCollection("user-only", { workspaceRoot: project })).toBeNull();
  });
});
