// @vitest-environment node
//
// `data/skills` is a WORKSPACE mechanism. It exists to route around the `.claude/` permission
// gate — the agent writes drafts to a plain data dir and a bridge mirrors the allowlisted files
// into `.claude/skills` — and MulmoTerminal runs no bridge outside the managed workspace.
//
// Two things follow, and both are asserted here because both fail silently: a project folder must
// get NO staging dir at all (core 3.1.0's `null`), and the guide the agent is served must not tell
// it to author there — an agent that obeys writes a draft nothing mirrors and nothing discovers,
// producing a collection that does not exist with no error anywhere.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { readCustomViewHtml, loadCollection } from "@mulmoclaude/core/collection/server";

import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { manageCollectionHandlerFor } from "../../../server/infra/collection-tool.js";
import { isManagedWorkspace } from "../../../server/backends/workspaceSetup.js";
import { makeTempDir } from "../../support/tempDir";

const SCHEMA = {
  title: "Tasks",
  icon: "star",
  dataPath: "data/tasks/items",
  primaryKey: "id",
  fields: { id: { type: "string", label: "ID", primary: true, required: true } },
  views: [{ id: "v1", file: "views/v1.html", label: "Custom", capabilities: ["read"] }],
};

/** A root with the collection in the place a PROJECT keeps it — the skill dir. */
function makeProject(prefix: string, viewBody: string): string {
  const root = makeTempDir(prefix);
  mkdirSync(path.join(root, ".claude", "skills", "tasks", "views"), { recursive: true });
  writeFileSync(path.join(root, ".claude", "skills", "tasks", "schema.json"), JSON.stringify(SCHEMA));
  writeFileSync(path.join(root, ".claude", "skills", "tasks", "views", "v1.html"), viewBody);
  mkdirSync(path.join(root, "data", "tasks", "items"), { recursive: true });
  return root;
}

describe("skill staging is workspace-only", () => {
  const savedWorkspaceEnv = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  let workspace = "";
  let project = "";

  // ONE binding for the file: `configureCollectionHost` refuses a second call with a different
  // host, deliberately — silently redirecting later filesystem work to another workspace would be
  // a bug, not a feature. So the roots are built once and each test writes only its own files.
  beforeAll(() => {
    workspace = makeProject("mt-staging-ws-", "<body>workspace view</body>");
    project = makeProject("mt-staging-proj-", "<body>project view</body>");
    // `isManagedWorkspace` compares against this, so a temp dir can stand in for ~/mulmoclaude.
    process.env.MULMOCLAUDE_WORKSPACE_PATH = workspace;
    initCollectionsBackend({ workspace, knownProjects: () => [{ label: "project", path: project }] });
  });

  afterAll(() => {
    if (savedWorkspaceEnv === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
    else process.env.MULMOCLAUDE_WORKSPACE_PATH = savedWorkspaceEnv;
  });

  // The regression that matters. The engine reads staging FIRST for a project-scope collection,
  // so before `null` a stray file there won — silently, and in a repo where the committed skill
  // is the one git carries.
  // A managed workspace is often reached by a symlink (`~/mulmoclaude` pointing elsewhere), and
  // the launcher may name it by either spelling. A lexical comparison read the physical path as
  // "not the workspace", which since core 3.1.0 means no staging dir and the project authoring
  // guide — the workspace quietly losing its staged views and being told to write elsewhere.
  it("recognises the managed workspace through a symlink", async () => {
    const link = path.join(makeTempDir("mt-staging-link-"), "workspace-link");
    symlinkSync(workspace, link, "dir");
    expect(isManagedWorkspace(link)).toBe(true);
    expect(isManagedWorkspace(realpathSync(link))).toBe(true);
  });

  it("does not let a stray data/skills view shadow the committed one", async () => {
    mkdirSync(path.join(project, "data", "skills", "tasks", "views"), { recursive: true });
    writeFileSync(path.join(project, "data", "skills", "tasks", "views", "v1.html"), "<body>STRAY</body>");

    const collection = await loadCollection("tasks", { workspaceRoot: project });
    if (!collection) throw new Error("fixture collection did not load");
    const html = await readCustomViewHtml(collection, "views/v1.html", { workspaceRoot: project });
    expect(html).toContain("project view");
    expect(html).not.toContain("STRAY");
  });

  // …while the workspace still resolves through staging, which is the layout its bridge produces.
  it("still prefers the workspace's staging copy", async () => {
    mkdirSync(path.join(workspace, "data", "skills", "tasks", "views"), { recursive: true });
    writeFileSync(path.join(workspace, "data", "skills", "tasks", "views", "v1.html"), "<body>STAGED</body>");
    // The staging tree is authoritative there only when it holds the schema too — the same
    // condition the bridge satisfies when it mirrors a draft.
    writeFileSync(path.join(workspace, "data", "skills", "tasks", "schema.json"), JSON.stringify(SCHEMA));

    const collection = await loadCollection("tasks", { workspaceRoot: workspace });
    if (!collection) throw new Error("fixture collection did not load");
    const html = await readCustomViewHtml(collection, "views/v1.html", { workspaceRoot: workspace });
    expect(html).toContain("STAGED");
  });

  // The other half: the instructions the agent reads.
  // Asserted on the INSTRUCTION, not on the string: the direct variant still says the words
  // "data/skills" — in the sentence telling the agent never to write there.
  it("serves an authoring guide that names the right directory for each root", async () => {
    const docs = (root: string) => manageCollectionHandlerFor(root)({ action: "schemaDocs", topic: "Anatomy of a collection skill" });

    const forProject = await docs(project);
    expect(forProject).toContain("Author under `.claude/skills/<slug>/`");
    expect(forProject).not.toContain("Author under `data/skills/<slug>/`");

    const forWorkspace = await docs(workspace);
    expect(forWorkspace).toContain("Author under `data/skills/<slug>/`");
    expect(forWorkspace).not.toContain("Author under `.claude/skills/<slug>/`");
  });
});
